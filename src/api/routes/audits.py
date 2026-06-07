import os
import time
from datetime import datetime
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert
from src.api.auth import is_admin, limit_key, require_owner_or_admin
from src.api.ratelimit import client_ip
from src.api.semaphore import get_audit_semaphore
from src.db import SessionLocal
from src.agents.orchestrator import orchestrate, BrandNotConfirmed
from src.models import AuditLimit, Brand


class AuditRequest(BaseModel):
    custom_questions: list[str] = []

router = APIRouter(prefix="/audit")

_jobs: dict = {}
_job_counter = 0


async def _run_audit_job(job_id: str, brand_id: int, custom_questions: list[str] | None = None):
    _jobs[job_id]["status"] = "running"

    def _emit(msg: str):
        evs = _jobs[job_id]["events"]
        evs.append({"t": time.time(), "msg": msg})
        if len(evs) > 200:  # bound growth
            del evs[: len(evs) - 200]

    try:
        async with SessionLocal() as session:
            insight = await orchestrate(session, brand_id, custom_questions=custom_questions, on_event=_emit)
        if insight:
            _jobs[job_id].update({
                "status": "completed",
                "probe_count": insight.probe_count,
                "visibility_pct": insight.visibility_pct,
                "summary": insight.summary,
            })
        else:
            _jobs[job_id]["status"] = "failed"
    except BrandNotConfirmed:
        # We couldn't confidently identify which company the user means. Distinct
        # status so the UI can ask for a domain instead of showing a fake/failed audit.
        _jobs[job_id]["status"] = "unconfirmed"
    except Exception as e:
        _jobs[job_id].update({"status": "failed", "error": str(e)})


@router.get("/limit-status")
async def get_limit_status(request: Request, session_id: str = None, x_admin_key: str = Header(None)):
    if is_admin(session_id, x_admin_key):
        return {"limit_reached": False, "count": 0, "max": 9999}

    key = limit_key(session_id, client_ip(request))
    async with SessionLocal() as session:
        limit = await session.get(AuditLimit, key)
        count = limit.audit_count if limit else 0
    return {"limit_reached": count >= 2, "count": count, "max": 2}


@router.post("/brands/{brand_id}")
async def start_audit(
    brand_id: int,
    background_tasks: BackgroundTasks,
    request: Request,
    body: AuditRequest = None,
    session_id: str = None,
    x_admin_key: str = Header(None),
):
    async with SessionLocal() as session:
        brand = await session.get(Brand, brand_id)
        if not brand:
            raise HTTPException(status_code=404, detail="Brand not found.")
        if brand.session_id == "example":
            raise HTTPException(status_code=400, detail="Cannot run new audits on preloaded example brands.")
        require_owner_or_admin(brand, session_id, x_admin_key)

        if not is_admin(session_id, x_admin_key):
            key = limit_key(session_id, client_ip(request))
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

    global _job_counter
    _job_counter += 1
    job_id = f"job_{_job_counter}"
    _jobs[job_id] = {"status": "queued", "brand_id": brand_id, "events": []}

    async def _run_with_semaphore(jid: str, bid: int, cq: list[str]):
        async with sem:
            await _run_audit_job(jid, bid, cq)

    if sem is not None:
        background_tasks.add_task(_run_with_semaphore, job_id, brand_id, custom_questions)
    else:
        background_tasks.add_task(_run_audit_job, job_id, brand_id, custom_questions)

    return {"job_id": job_id, "status": "queued"}


@router.get("/{job_id}")
async def get_job_status(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job
