import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.db import engine, Base, SessionLocal
from src.db_seed import seed_example_brands
from src.api.routes.brands import router as brands_router
from src.api.routes.audits import router as audits_router

MAX_CONCURRENT_AUDITS = 3
_audit_semaphore: asyncio.Semaphore | None = None


def get_audit_semaphore() -> asyncio.Semaphore | None:
    return _audit_semaphore


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _audit_semaphore
    _audit_semaphore = asyncio.Semaphore(MAX_CONCURRENT_AUDITS)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
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
