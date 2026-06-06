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


# Idempotent migrations for schema changes made after the initial deploy.
# create_all() only adds missing tables/columns — it cannot rename columns or add
# constraints to existing tables, so those are handled explicitly here.
_MIGRATIONS = [
    "ALTER TABLE brands ADD COLUMN IF NOT EXISTS industry VARCHAR(100)",
    # Rename audit_limits.ip_address -> rate_key (the key is no longer always an IP)
    """DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='audit_limits' AND column_name='ip_address') THEN
            ALTER TABLE audit_limits RENAME COLUMN ip_address TO rate_key;
        END IF;
    END $$;""",
    # Unique constraint on probe_performance(brand_id, prompt_hash) to stop duplicate rows
    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_probe_brand_hash') THEN
            ALTER TABLE probe_performance ADD CONSTRAINT uq_probe_brand_hash
                UNIQUE (brand_id, prompt_hash);
        END IF;
    END $$;""",
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    _check_env()
    init_audit_semaphore(max_concurrent=3)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for stmt in _MIGRATIONS:
            await conn.execute(text(stmt))
    async with SessionLocal() as session:
        await seed_example_brands(session)
    maybe_seed_audits(app)
    yield


def maybe_seed_audits(app: FastAPI) -> None:
    """Placeholder wired up in the auto-audit feature (task #7)."""
    pass


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
