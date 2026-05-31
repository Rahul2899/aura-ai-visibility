import asyncio
from fastapi import APIRouter, BackgroundTasks, HTTPException
from src.db import SessionLocal
from src.agents.orchestrator import orchestrate

router = APIRouter(prefix="/audit")

# In-memory job store: {job_id: {"status": ..., "probe_count": ..., "insight": ...}}
# Simple dict is fine — jobs are ephemeral and this is a single-process server.
_jobs: dict = {}
_job_counter = 0


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


@router.post("/brands/{brand_id}")
async def start_audit(brand_id: int, background_tasks: BackgroundTasks):
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
