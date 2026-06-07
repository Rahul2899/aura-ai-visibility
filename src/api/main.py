import asyncio
import os
import warnings
import structlog
from contextlib import asynccontextmanager, nullcontext
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text, select, func
from src.db import engine, Base, SessionLocal
from src.db_seed import seed_example_brands
from src.api.semaphore import init_audit_semaphore, get_audit_semaphore
from src.api.routes.brands import router as brands_router
from src.api.routes.audits import router as audits_router
from src.models import Brand, Insight

log = structlog.get_logger()

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
    "ALTER TABLE brands ADD COLUMN IF NOT EXISTS share_token VARCHAR(64)",
    """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_brand_share_token') THEN
            ALTER TABLE brands ADD CONSTRAINT uq_brand_share_token UNIQUE (share_token);
        END IF;
    END $$;""",
    # Rename audit_limits.ip_address -> rate_key (the key is no longer always an IP)
    """DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='audit_limits' AND column_name='ip_address') THEN
            ALTER TABLE audit_limits RENAME COLUMN ip_address TO rate_key;
        END IF;
    END $$;""",
    # Deduplicate probe_performance before adding the unique constraint. Old buggy code
    # (SELECT-then-INSERT race) could create duplicate (brand_id, prompt_hash) rows.
    # Merge counts into the lowest-id row, then drop the extras.
    """UPDATE probe_performance p SET
            run_count = agg.total_runs,
            hit_count = agg.total_hits
        FROM (
            SELECT brand_id, prompt_hash,
                   MIN(id) AS keep_id,
                   SUM(run_count) AS total_runs,
                   SUM(hit_count) AS total_hits
            FROM probe_performance
            GROUP BY brand_id, prompt_hash
            HAVING COUNT(*) > 1
        ) agg
        WHERE p.id = agg.keep_id;""",
    """DELETE FROM probe_performance p USING (
            SELECT brand_id, prompt_hash, MIN(id) AS keep_id
            FROM probe_performance
            GROUP BY brand_id, prompt_hash
            HAVING COUNT(*) > 1
        ) agg
        WHERE p.brand_id = agg.brand_id
          AND p.prompt_hash = agg.prompt_hash
          AND p.id <> agg.keep_id;""",
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

    # Auto-populate example brands on a fresh deploy so the dashboard isn't empty.
    # Runs in the background — never blocks startup, never crashes the app on failure.
    if _autoaudit_enabled():
        app.state.seed_task = asyncio.create_task(_seed_example_audits())

    yield

    task = getattr(app.state, "seed_task", None)
    if task and not task.done():
        task.cancel()


def _autoaudit_enabled() -> bool:
    # Needs Bedrock creds (or an EC2 IAM role) and must be explicitly allowed.
    if os.environ.get("AUTO_SEED_AUDITS", "true").lower() in ("0", "false", "no"):
        return False
    return bool(os.environ.get("AWS_ACCESS_KEY_ID") or os.environ.get("AWS_REGION"))


async def _seed_example_audits() -> None:
    """For each example brand with no insight, run one audit. Bounded by the global
    semaphore so we never exceed the concurrency cap. Failures are logged, not raised —
    a fresh deploy with bad creds simply shows empty brands rather than crashing."""
    # Import here to avoid a circular import at module load (orchestrator imports models).
    from src.agents.orchestrator import orchestrate

    try:
        async with SessionLocal() as session:
            counts = dict(
                (await session.execute(
                    select(Insight.brand_id, func.count(Insight.id)).group_by(Insight.brand_id)
                )).all()
            )
            example_brands = (await session.scalars(
                select(Brand).where(Brand.session_id == "example")
            )).all()
            to_seed = [b.id for b in example_brands if counts.get(b.id, 0) == 0]

        if not to_seed:
            log.info("autoaudit_skip", reason="all example brands already audited")
            return

        log.info("autoaudit_start", brands=to_seed)
        sem = get_audit_semaphore()

        async def _run(brand_id: int):
            try:
                async with (sem if sem is not None else nullcontext()):
                    async with SessionLocal() as session:
                        await orchestrate(session, brand_id)
                log.info("autoaudit_brand_done", brand_id=brand_id)
            except Exception as e:
                log.warning("autoaudit_brand_failed", brand_id=brand_id, error=str(e))

        await asyncio.gather(*[_run(bid) for bid in to_seed])
        log.info("autoaudit_complete")
    except asyncio.CancelledError:
        log.info("autoaudit_cancelled")
        raise
    except Exception as e:
        log.warning("autoaudit_failed", error=str(e))


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
