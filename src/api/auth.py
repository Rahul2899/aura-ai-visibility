import os
from fastapi import HTTPException
from src.models import Brand


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
