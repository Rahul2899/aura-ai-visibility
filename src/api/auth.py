import os
from fastapi import HTTPException, Header
from src.models import Brand


def get_session_id(
    x_session_id: str | None = Header(default=None),
    session_id: str | None = None,
) -> str | None:
    """Resolve the caller's session token, preferring the X-Session-Id HEADER over the
    legacy ?session_id= query param. The token is a bearer credential (proves brand
    ownership); in a header it stays out of URLs/proxy logs/browser history. The query
    fallback is kept for backward compatibility (cached frontends, old share links)
    and can be removed once no clients send it in the URL."""
    return x_session_id or session_id


def is_admin(session_id: str | None, x_admin_key: str | None) -> bool:
    expected = os.environ.get("ADMIN_KEY")
    return bool(expected and x_admin_key == expected and session_id == "admin")


def can_read_brand(brand: Brand, session_id: str | None, x_admin_key: str | None) -> bool:
    if brand.session_id == "example":
        return True
    if is_admin(session_id, x_admin_key):
        return True
    return session_id is not None and session_id == brand.session_id


def require_read(brand: Brand, session_id: str | None, x_admin_key: str | None) -> None:
    if not can_read_brand(brand, session_id, x_admin_key):
        raise HTTPException(status_code=403, detail="Not authorized to view this brand")


def require_owner_or_admin(brand: Brand, session_id: str | None, x_admin_key: str | None) -> None:
    if is_admin(session_id, x_admin_key):
        return
    if session_id is not None and session_id == brand.session_id:
        return
    raise HTTPException(status_code=403, detail="Not authorized")


def limit_key(session_id: str | None, ip: str) -> str:
    if session_id and session_id not in ("", "admin") and not session_id.startswith("ip:"):
        return session_id
    return f"ip:{ip}"
