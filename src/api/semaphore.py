import asyncio

_audit_semaphore: asyncio.Semaphore | None = None


def init_audit_semaphore(max_concurrent: int = 3) -> None:
    global _audit_semaphore
    _audit_semaphore = asyncio.Semaphore(max_concurrent)


def get_audit_semaphore() -> asyncio.Semaphore | None:
    return _audit_semaphore
