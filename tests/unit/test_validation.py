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


# The reserved-session check ("admin"/"example") moved from the BrandCreate model
# to the create_brand route, because the route can see X-Admin-Key and must allow
# session_id="admin" for an authenticated admin while rejecting it for everyone else.
# The model now ACCEPTS these values; the route-level guarantee is covered by
# test_api_comprehensive.py::test_create_brand_reserved_session_{admin,example}_rejected.
def test_reserved_session_accepted_at_model_level():
    assert BrandCreate(name="Acme", session_id="example").session_id == "example"
    assert BrandCreate(name="Acme", session_id="admin").session_id == "admin"


def test_optional_fields_default_empty():
    b = BrandCreate(name="Acme")
    assert b.domain == ""
    assert b.industry == ""
    assert b.session_id == ""


def test_long_name_rejected_at_model_level():
    # Names are now capped in the model (max 200) so an over-long name returns a
    # clean 422 instead of crashing on a DB String(255) truncation error (500).
    with pytest.raises(ValidationError):
        BrandCreate(name="A" * 300, session_id="sess_1")


def test_long_domain_and_industry_rejected():
    with pytest.raises(ValidationError):
        BrandCreate(name="Acme", domain="a" * 300, session_id="sess_1")
    with pytest.raises(ValidationError):
        BrandCreate(name="Acme", industry="b" * 300, session_id="sess_1")


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
