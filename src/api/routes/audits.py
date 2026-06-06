import os
from datetime import datetime
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Header
from fastapi.responses import JSONResponse
from src.api.auth import is_admin, limit_key, require_owner_or_admin
from src.api.semaphore import get_audit_semaphore
from src.db import SessionLocal
from src.agents.orchestrator import orchestrate
from src.models import AuditLimit, Brand

router = APIRouter(prefix="/audit")

_jobs: dict = {}
_job_counter = 0


def get_client_ip(request: Request) -> str:
    x_forwarded_for = request.headers.get("x-forwarded-for")
    if x_forwarded_for:
        return x_forwarded_for.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


async def _run_audit_job(job_id: str, brand_id: int):
    _jobs[job_id]["status"] = "running"
    try:
        async with SessionLocal() as session:
            insight = await orchestrate(session, brand_id)
        if insight:
            _jobs[job_id].update({
                "status": "completed",
                "probe_count": insight.probe_count,
                "visibility_pct": insight.visibility_pct,
                "summary": insight.summary,
            })
        else:
            _jobs[job_id]["status"] = "failed"
    except Exception as e:
        _jobs[job_id].update({"status": "failed", "error": str(e)})


@router.get("/limit-status")
async def get_limit_status(request: Request, session_id: str = None, x_admin_key: str = Header(None)):
    if is_admin(session_id, x_admin_key):
        return {"limit_reached": False, "count": 0, "max": 9999}

    key = limit_key(session_id, get_client_ip(request))
    async with SessionLocal() as session:
        limit = await session.get(AuditLimit, key)
        count = limit.audit_count if limit else 0
    return {"limit_reached": count >= 2, "count": count, "max": 2}


@router.post("/brands/{brand_id}")
async def start_audit(
    brand_id: int,
    background_tasks: BackgroundTasks,
    request: Request,
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
            key = limit_key(session_id, get_client_ip(request))
            limit = await session.get(AuditLimit, key)
            if limit and limit.audit_count >= 2:
                raise HTTPException(
                    status_code=429,
                    detail="Audit limit exceeded. You can run up to 2 audits per session.",
                )
            if limit:
                limit.audit_count += 1
                limit.last_audit_at = datetime.utcnow()
            else:
                session.add(AuditLimit(ip_address=key, audit_count=1, last_audit_at=datetime.utcnow()))
            await session.commit()

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

    global _job_counter
    _job_counter += 1
    job_id = f"job_{_job_counter}"
    _jobs[job_id] = {"status": "queued", "brand_id": brand_id}

    async def _run_with_semaphore(jid: str, bid: int):
        async with sem:
            await _run_audit_job(jid, bid)

    if sem is not None:
        background_tasks.add_task(_run_with_semaphore, job_id, brand_id)
    else:
        background_tasks.add_task(_run_audit_job, job_id, brand_id)

    return {"job_id": job_id, "status": "queued"}


@router.get("/{job_id}")
async def get_job_status(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job
