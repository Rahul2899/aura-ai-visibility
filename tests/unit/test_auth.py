"""Unit tests for auth decision logic. No DB — uses a lightweight fake Brand."""
import os
from dataclasses import dataclass

import pytest
from fastapi import HTTPException

from src.api.auth import (
    is_admin,
    can_read_brand,
    require_read,
    require_owner_or_admin,
    limit_key,
)

ADMIN_KEY = os.environ["ADMIN_KEY"]  # set by conftest


@dataclass
class FakeBrand:
    session_id: str | None


# ── is_admin ──────────────────────────────────────────────────────────────────

def test_is_admin_true_with_correct_key_and_session():
    assert is_admin("admin", ADMIN_KEY) is True


def test_is_admin_false_wrong_key():
    assert is_admin("admin", "wrong-key") is False


def test_is_admin_false_wrong_session():
    assert is_admin("not-admin", ADMIN_KEY) is False


def test_is_admin_false_no_key():
    assert is_admin("admin", None) is False


def test_is_admin_false_literal_none_string():
    # A client sending the literal header value "None" must not authenticate
    assert is_admin("admin", "None") is False


def test_is_admin_false_empty_key():
    assert is_admin("admin", "") is False


# ── can_read_brand ────────────────────────────────────────────────────────────

def test_example_brand_readable_by_anyone():
    assert can_read_brand(FakeBrand("example"), None, None) is True


def test_example_brand_readable_no_session():
    assert can_read_brand(FakeBrand("example"), "", None) is True


def test_owner_can_read_own_brand():
    assert can_read_brand(FakeBrand("sess_abc"), "sess_abc", None) is True


def test_intruder_cannot_read_others_brand():
    assert can_read_brand(FakeBrand("sess_owner"), "sess_intruder", None) is False


def test_no_session_cannot_read_user_brand():
    assert can_read_brand(FakeBrand("sess_owner"), None, None) is False


def test_admin_can_read_any_brand():
    assert can_read_brand(FakeBrand("sess_owner"), "admin", ADMIN_KEY) is True


def test_none_session_brand_not_readable_by_none_session():
    # A brand with session_id=None must not be readable by a None requester
    assert can_read_brand(FakeBrand(None), None, None) is False


# ── require_read / require_owner_or_admin ─────────────────────────────────────

def test_require_read_raises_403_for_intruder():
    with pytest.raises(HTTPException) as exc:
        require_read(FakeBrand("sess_owner"), "sess_intruder", None)
    assert exc.value.status_code == 403


def test_require_read_passes_for_owner():
    require_read(FakeBrand("sess_owner"), "sess_owner", None)  # no raise


def test_require_owner_or_admin_raises_for_example_brand_non_owner():
    # Example brands are readable but NOT ownable — must 403 on owner check
    with pytest.raises(HTTPException) as exc:
        require_owner_or_admin(FakeBrand("example"), "sess_x", None)
    assert exc.value.status_code == 403


def test_require_owner_or_admin_passes_for_admin():
    require_owner_or_admin(FakeBrand("anything"), "admin", ADMIN_KEY)  # no raise


def test_require_owner_or_admin_raises_no_session():
    with pytest.raises(HTTPException):
        require_owner_or_admin(FakeBrand("sess_owner"), None, None)


# ── limit_key ─────────────────────────────────────────────────────────────────

def test_limit_key_uses_session_when_present():
    assert limit_key("sess_abc", "1.2.3.4") == "sess_abc"


def test_limit_key_falls_back_to_ip_for_empty_session():
    assert limit_key("", "1.2.3.4") == "ip:1.2.3.4"


def test_limit_key_falls_back_to_ip_for_none_session():
    assert limit_key(None, "1.2.3.4") == "ip:1.2.3.4"


def test_limit_key_admin_session_uses_ip():
    # 'admin' session must not become a shared rate-limit bucket
    assert limit_key("admin", "1.2.3.4") == "ip:1.2.3.4"


def test_limit_key_does_not_double_prefix_ip():
    # A session already shaped like 'ip:...' must not be trusted as a session key
    assert limit_key("ip:9.9.9.9", "1.2.3.4") == "ip:1.2.3.4"
