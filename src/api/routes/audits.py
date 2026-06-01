import asyncio
import os
from datetime import datetime
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Header
from src.db import SessionLocal
from src.agents.orchestrator import orchestrate
from src.models import AuditLimit, Brand

router = APIRouter(prefix="/audit")

# In-memory job store: {job_id: {"status": ..., "probe_count": ..., "insight": ...}}
_jobs: dict = {}
_job_counter = 0


def get_client_ip(request: Request) -> str:
    """Extract real client IP. Use rightmost value — nginx appends the real IP last.
    The leftmost value is attacker-controlled and must never be trusted for rate limiting."""
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
async def get_limit_status(request: Request, session_id: str = None):
    """Retrieve audit usage status for current client."""
    # Admins are exempt from rate limits
    if session_id == "admin":
        return {"limit_reached": False, "count": 0, "max": 9999}
    
    ip = get_client_ip(request)
    async with SessionLocal() as session:
        limit = await session.get(AuditLimit, ip)
        count = limit.audit_count if limit else 0
    return {"limit_reached": count >= 2, "count": count, "max": 2}


@router.post("/brands/{brand_id}")
async def start_audit(
    brand_id: int, 
    background_tasks: BackgroundTasks, 
    request: Request,
    session_id: str = None,
    x_admin_key: str = Header(None)
):
    # 1. Enforce IP-based rate limiting for non-admin requests
    is_admin = False
    if session_id == "admin":
        expected_key = os.environ.get("ADMIN_KEY")
        if x_admin_key == expected_key:
            is_admin = True

    if not is_admin:
        ip = get_client_ip(request)
        async with SessionLocal() as session:
            # Prevent auditing preloaded example brands to save API credits
            brand = await session.get(Brand, brand_id)
            if brand and brand.session_id == "example":
                raise HTTPException(status_code=400, detail="Cannot run new audits on preloaded example brands.")

            limit = await session.get(AuditLimit, ip)
            if limit:
                if limit.audit_count >= 2:
                    raise HTTPException(
                        status_code=429, 
                        detail="Audit limit exceeded. Public users can only run up to 2 audits."
                    )
                limit.audit_count += 1
                limit.last_audit_at = datetime.utcnow()
            else:
                limit = AuditLimit(ip_address=ip, audit_count=1, last_audit_at=datetime.utcnow())
                session.add(limit)
            await session.commit()

    # 2. Queue audit execution
    global _job_counter
    _job_counter += 1
    job_id = f"job_{_job_counter}"
    _jobs[job_id] = {"status": "queued", "brand_id": brand_id}
    background_tasks.add_task(_run_audit_job, job_id, brand_id)
    return {"job_id": job_id, "status": "queued"}


@router.get("/{job_id}")
async def get_job_status(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job
