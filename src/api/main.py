import os
import warnings
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from src.db import engine, Base, SessionLocal
from src.db_seed import seed_example_brands
from src.api.semaphore import init_audit_semaphore
from src.api.routes.brands import router as brands_router
from src.api.routes.audits import router as audits_router

_REQUIRED_VARS = ["DATABASE_URL", "ADMIN_KEY"]
_OPTIONAL_WARN = ["AWS_ACCESS_KEY_ID", "OPENROUTER_API_KEY", "TAVILY_API_KEY"]


def _check_env():
    missing = [v for v in _REQUIRED_VARS if not os.environ.get(v)]
    if missing:
        raise RuntimeError(f"Missing required env vars: {', '.join(missing)}")
    for v in _OPTIONAL_WARN:
        if not os.environ.get(v):
            warnings.warn(f"Optional env var {v} not set — related features will be degraded", stacklevel=2)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _check_env()
    init_audit_semaphore(max_concurrent=3)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Add columns introduced after initial deploy (safe to run repeatedly)
        await conn.execute(text(
            "ALTER TABLE brands ADD COLUMN IF NOT EXISTS industry VARCHAR(100)"
        ))
    async with SessionLocal() as session:
        await seed_example_brands(session)
    yield


app = FastAPI(title="Aura AI API", lifespan=lifespan)

_allowed_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "X-Admin-Key"],
)

app.include_router(brands_router)
app.include_router(audits_router)
