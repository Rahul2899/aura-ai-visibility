"""Unit tests for request-model validation (BrandCreate, AuditRequest)."""
import pytest
from pydantic import ValidationError

from src.api.routes.brands import BrandCreate
from src.api.routes.audits import AuditRequest


# ── BrandCreate ───────────────────────────────────────────────────────────────

def test_valid_brand():
    b = BrandCreate(name="Acme", session_id="sess_1")
    assert b.name == "Acme"


def test_name_is_stripped():
    b = BrandCreate(name="  Acme  ", session_id="sess_1")
    assert b.name == "Acme"


def test_empty_name_rejected():
    with pytest.raises(ValidationError):
        BrandCreate(name="", session_id="sess_1")


def test_whitespace_only_name_rejected():
    with pytest.raises(ValidationError):
        BrandCreate(name="   ", session_id="sess_1")


def test_reserved_session_example_rejected():
    with pytest.raises(ValidationError):
        BrandCreate(name="Acme", session_id="example")


def test_reserved_session_admin_rejected():
    with pytest.raises(ValidationError):
        BrandCreate(name="Acme", session_id="admin")


def test_optional_fields_default_empty():
    b = BrandCreate(name="Acme")
    assert b.domain == ""
    assert b.industry == ""
    assert b.session_id == ""


def test_long_name_accepted_at_model_level():
    # Length is enforced at the DB column (String(255)), not the request model.
    b = BrandCreate(name="A" * 300, session_id="sess_1")
    assert len(b.name) == 300


# ── AuditRequest ──────────────────────────────────────────────────────────────

def test_audit_request_defaults_empty_list():
    a = AuditRequest()
    assert a.custom_questions == []


def test_audit_request_accepts_questions():
    a = AuditRequest(custom_questions=["q1", "q2"])
    assert a.custom_questions == ["q1", "q2"]


def test_custom_question_cleaning_logic():
    # Mirrors the cleaning done in start_audit: strip, drop blanks, cap at 5.
    raw = ["  keep  ", "", "   ", "also keep", "a", "b", "c", "d", "e", "f"]
    cleaned = [q.strip() for q in raw if q.strip()][:5]
    assert cleaned == ["keep", "also keep", "a", "b", "c"]
    assert len(cleaned) <= 5
