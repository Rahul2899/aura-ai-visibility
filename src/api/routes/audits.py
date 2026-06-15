import os
import time
import structlog
from datetime import datetime
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator
from sqlalchemy.dialects.postgresql import insert as pg_insert
from src.api.auth import is_admin, limit_key, require_owner_or_admin
from src.api.ratelimit import client_ip
from src.api.semaphore import get_audit_semaphore
from src.db import SessionLocal
from src.agents.orchestrator import orchestrate, preview_audit, BrandNotConfirmed
from src.models import AuditLimit, Brand

log = structlog.get_logger()


class AuditRequest(BaseModel):
    custom_questions: list[str] = []
    category: str | None = None  # user-confirmed category from the preview step (optional)
    region: str | None = None    # user-chosen market ("Europe", "Germany", ...) or None=Global

    # Defense-in-depth caps on attacker-controlled input that flows into LLM prompts.
    # Bounds the payload (no huge-body parsing) and the per-question length (a long
    # prompt-injection string can't bloat the prompt or run up Bedrock cost). The route
    # still strips + slices to 5; these reject abusive payloads at the schema boundary.
    @field_validator("custom_questions")
    @classmethod
    def _cap_questions(cls, v: list[str]) -> list[str]:
        if len(v) > 20:
            raise ValueError("Too many custom questions (max 20).")
        return [q[:500] for q in v]

    @field_validator("category")
    @classmethod
    def _cap_category(cls, v: str | None) -> str | None:
        return v[:120] if v else v

router = APIRouter(prefix="/audit")

# Platform-wide safety cap on total audits per UTC day. Protects the AWS/Bedrock bill
# regardless of how many sessions/browsers/incognito tabs one person opens — the
# per-session limit is good-faith friction; THIS is the hard ceiling on spend.
# Override via env for a launch spike without a redeploy. Resets at UTC midnight
# (the counter key embeds the date).
GLOBAL_DAILY_AUDIT_CAP = int(os.environ.get("GLOBAL_DAILY_AUDIT_CAP", "50"))

_jobs: dict = {}
_job_counter = 0
# "session::batch_id" keys that have already been charged one audit credit, so the rest
# of a comparison's brand audits run free. In-memory is fine: a batch is short-lived and
# the worst case of a process restart is one comparison costing an extra credit.
_charged_batches: set[str] = set()


async def _refund_audit_slot(rate_key: str | None):
    """Give back one audit-limit slot. Used when an audit produced no usable result
    (brand couldn't be confirmed), so the user isn't charged for a non-answer."""
    if not rate_key:
        return
    try:
        async with SessionLocal() as session:
            limit = await session.get(AuditLimit, rate_key)
            if limit and limit.audit_count > 0:
                limit.audit_count -= 1
                await session.commit()
    except Exception as e:
        log.warning("audit_refund_failed", rate_key=rate_key, error=str(e))


async def _run_audit_job(job_id: str, brand_id: int, custom_questions: list[str] | None = None, rate_key: str | None = None, category: str | None = None, region: str | None = None):
    _jobs[job_id]["status"] = "running"

    def _emit(msg: str):
        evs = _jobs[job_id]["events"]
        evs.append({"t": time.time(), "msg": msg})
        if len(evs) > 200:  # bound growth
            del evs[: len(evs) - 200]

    try:
        async with SessionLocal() as session:
            insight = await orchestrate(session, brand_id, custom_questions=custom_questions, category_override=category, region=region, on_event=_emit)
        if insight:
            _jobs[job_id].update({
                "status": "completed",
                "probe_count": insight.probe_count,
                "visibility_pct": insight.visibility_pct,
                "summary": insight.summary,
            })
        else:
            _jobs[job_id]["status"] = "failed"
            await _refund_audit_slot(rate_key)
    except BrandNotConfirmed:
        # Couldn't confidently identify which company the user means. Distinct status
        # so the UI can ask for a domain; refund the slot since they got no result.
        _jobs[job_id]["status"] = "unconfirmed"
        await _refund_audit_slot(rate_key)
    except Exception as e:
        _jobs[job_id].update({"status": "failed", "error": str(e)})
        await _refund_audit_slot(rate_key)


@router.get("/limit-status")
async def get_limit_status(request: Request, session_id: str = None, x_admin_key: str = Header(None)):
    if is_admin(session_id, x_admin_key):
        return {"limit_reached": False, "count": 0, "max": 9999}

    key = limit_key(session_id, client_ip(request))
    async with SessionLocal() as session:
        limit = await session.get(AuditLimit, key)
        count = limit.audit_count if limit else 0
    return {"limit_reached": count >= 2, "count": count, "max": 2}


@router.post("/brands/{brand_id}/preview")
async def preview_audit_route(
    brand_id: int,
    session_id: str = None,
    x_admin_key: str = Header(None),
):
    """Cheap pre-audit step: web search + entity check + category inference, NO probes.
    Lets the UI confirm which brand/category before spending a full audit. Not rate-limited
    (it's cheap and the real audit charges)."""
    async with SessionLocal() as session:
        brand = await session.get(Brand, brand_id)
        if not brand:
            raise HTTPException(status_code=404, detail="Brand not found.")
        require_owner_or_admin(brand, session_id, x_admin_key)
        try:
            return await preview_audit(session, brand_id)
        except Exception as e:
            log.warning("preview_failed", brand_id=brand_id, error=str(e))
            # Don't block the flow on a preview failure — let the user run the audit anyway.
            return {"found": True, "category": "", "summary": "", "source": "none"}


@router.post("/brands/{brand_id}")
async def start_audit(
    brand_id: int,
    background_tasks: BackgroundTasks,
    request: Request,
    body: AuditRequest = None,
    session_id: str = None,
    batch_id: str = None,  # Compare runs several brands as ONE comparison — they share a
                           # batch_id so the whole comparison costs a single audit credit.
    x_admin_key: str = Header(None),
):
    rate_key = None  # set for non-admins; passed to the job so it can refund on no-result
    async with SessionLocal() as session:
        brand = await session.get(Brand, brand_id)
        if not brand:
            raise HTTPException(status_code=404, detail="Brand not found.")
        if brand.session_id == "example":
            raise HTTPException(status_code=400, detail="Cannot run new audits on preloaded example brands.")
        require_owner_or_admin(brand, session_id, x_admin_key)

    # If an audit for this brand is already in flight, don't start another (and don't
    # charge a limit slot) — tell the user to wait for the running one to finish.
    if any(j.get("brand_id") == brand_id and j.get("status") in ("queued", "running") for j in _jobs.values()):
        raise HTTPException(
            status_code=409,
            detail="An audit for this brand is already running. Please wait for it to finish.",
        )

    # A comparison audits several brands but must cost the user only ONE credit. All
    # brands in one comparison send the same batch_id; we charge the limit for the FIRST
    # request of a batch and skip it for the rest. (Per session+batch so it can't be
    # abused to bypass the limit across separate comparisons.)
    batch_already_charged = False
    if batch_id:
        batch_key = f"{session_id or client_ip(request)}::{batch_id}"
        batch_already_charged = batch_key in _charged_batches
        _charged_batches.add(batch_key)

    # Platform-wide daily cap. Every non-admin audit counts (including each brand in a
    # comparison — they each cost a real Bedrock run even though the USER is charged one
    # credit). Atomic increment on a per-day key; reject once the day's total is reached.
    # This is the real spend ceiling that incognito/VPN/browser-switching can't dodge.
    if not is_admin(session_id, x_admin_key):
        global_key = f"global:{datetime.utcnow():%Y-%m-%d}"
        async with SessionLocal() as session:
            stmt = (
                pg_insert(AuditLimit)
                .values(rate_key=global_key, audit_count=1, last_audit_at=datetime.utcnow())
                .on_conflict_do_update(
                    index_elements=["rate_key"],
                    set_={
                        "audit_count": AuditLimit.audit_count + 1,
                        "last_audit_at": datetime.utcnow(),
                    },
                )
                .returning(AuditLimit.audit_count)
            )
            global_count = (await session.execute(stmt)).scalar_one()
            await session.commit()
        if global_count > GLOBAL_DAILY_AUDIT_CAP:
            # Day's cap hit — refund the global increment and reject. (No per-session
            # charge has happened yet, so nothing else to undo.)
            await _refund_audit_slot(global_key)
            raise HTTPException(
                status_code=429,
                detail="Aura AI has hit today's free-audit limit. Please try again tomorrow.",
            )

    # Enforce the per-session audit limit. The increment happens HERE (at request time),
    # so a queued/running audit already counts — a 3rd request while 2 are in flight is
    # blocked even before any result lands.
    if not is_admin(session_id, x_admin_key) and not batch_already_charged:
        key = rate_key = limit_key(session_id, client_ip(request))
        async with SessionLocal() as session:
            # Atomic upsert + increment. Two audits firing at once for the same key
            # (e.g. Compare's parallel runs) would otherwise both INSERT and crash on
            # the primary-key constraint. ON CONFLICT increments in one statement and
            # RETURNs the post-increment count, which we check to enforce the limit.
            stmt = (
                pg_insert(AuditLimit)
                .values(rate_key=key, audit_count=1, last_audit_at=datetime.utcnow())
                .on_conflict_do_update(
                    index_elements=["rate_key"],
                    set_={
                        "audit_count": AuditLimit.audit_count + 1,
                        "last_audit_at": datetime.utcnow(),
                    },
                )
                .returning(AuditLimit.audit_count)
            )
            new_count = (await session.execute(stmt)).scalar_one()
            await session.commit()
        if new_count > 2:
            # Over the limit — refund the increment we just made and reject.
            await _refund_audit_slot(rate_key)
            raise HTTPException(
                status_code=429,
                detail="Audit limit exceeded. You can run up to 2 audits per session.",
            )

    sem = get_audit_semaphore()
    if sem is not None and sem.locked():
        return JSONResponse(
            status_code=503,
            content={
                "error": "too_busy",
                "message": "Aura AI is processing too many audits right now. Please try again in 2-3 minutes.",
                "retry_after_seconds": 120,
            },
            headers={"Retry-After": "120"},
        )

    custom_questions = [q.strip() for q in (body.custom_questions if body else []) if q.strip()][:5]
    category = (body.category.strip()[:60] if body and body.category and body.category.strip() else None)
    region = (body.region.strip()[:60] if body and body.region and body.region.strip() else None)

    global _job_counter
    _job_counter += 1
    job_id = f"job_{_job_counter}"
    _jobs[job_id] = {"status": "queued", "brand_id": brand_id, "events": []}

    async def _run_with_semaphore(jid: str, bid: int, cq: list[str], rk: str | None, cat: str | None, reg: str | None):
        async with sem:
            await _run_audit_job(jid, bid, cq, rate_key=rk, category=cat, region=reg)

    if sem is not None:
        background_tasks.add_task(_run_with_semaphore, job_id, brand_id, custom_questions, rate_key, category, region)
    else:
        background_tasks.add_task(_run_audit_job, job_id, brand_id, custom_questions, rate_key=rate_key, category=category, region=region)

    return {"job_id": job_id, "status": "queued"}


@router.get("/{job_id}")
async def get_job_status(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job
