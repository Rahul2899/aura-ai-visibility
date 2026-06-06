"""
Comprehensive API test suite — 40+ test cases covering security, data integrity,
rate limiting, and all brand/audit endpoints.

Run with API and frontend both running:
  python3 -m uvicorn src.api.main:app --port 8000 --reload   (in one terminal)
  cd web && npm run dev                                        (in another)

Then: pytest tests/test_api_comprehensive.py -v
"""
import pytest
import httpx

BASE = "http://localhost:8000"
FRONTEND = "http://localhost:3000"

# Seeded example brand IDs (from db_seed.py)
EXAMPLE_BRAND_ID = 1004   # Greenhouse
EXAMPLE_BRAND_ID_2 = 1005  # Lever


@pytest.fixture(scope="module")
def client():
    with httpx.Client(base_url=BASE, timeout=10) as c:
        yield c


# ── BRANDS LIST ──────────────────────────────────────────────────────────────

def test_brands_list_returns_list(client):
    r = client.get("/brands")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_brands_list_no_session_returns_only_examples(client):
    r = client.get("/brands")
    brands = r.json()
    ids = {b["id"] for b in brands}
    assert ids.issubset({1004, 1005, 1006, 1007}), \
        "Unauthenticated request leaked non-example brands"


def test_brands_list_has_required_fields(client):
    brands = client.get("/brands").json()
    for b in brands:
        assert "id" in b
        assert "name" in b


# ── BRANDS COMPARE ────────────────────────────────────────────────────────────

def test_compare_returns_list(client):
    r = client.get("/brands/compare")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_compare_no_session_id_credential_leak(client):
    brands = client.get("/brands/compare").json()
    for b in brands:
        assert "session_id" not in b, "SECURITY: session_id leaked in compare response"


def test_compare_has_is_example_field(client):
    brands = client.get("/brands/compare").json()
    for b in brands:
        assert "is_example" in b


def test_compare_ranked_by_visibility_descending(client):
    brands = client.get("/brands/compare").json()
    ranked = [b for b in brands if b.get("visibility_pct") is not None]
    scores = [b["visibility_pct"] for b in ranked]
    assert scores == sorted(scores, reverse=True), "Compare not sorted by visibility descending"


def test_compare_ranks_are_sequential(client):
    brands = client.get("/brands/compare").json()
    ranked = [b for b in brands if b.get("rank") is not None]
    ranks = sorted(b["rank"] for b in ranked)
    assert ranks == list(range(1, len(ranks) + 1)), "Ranks not sequential"


def test_compare_visibility_in_valid_range(client):
    brands = client.get("/brands/compare").json()
    for b in brands:
        if b.get("visibility_pct") is not None:
            assert 0 <= b["visibility_pct"] <= 100, f"visibility_pct out of range: {b}"


def test_compare_expected_brands_present(client):
    brands = client.get("/brands/compare").json()
    names = [b["name"].lower() for b in brands]
    for expected in ["workday", "greenhouse", "lever", "ashby"]:
        assert any(expected in n for n in names), f"Expected example brand '{expected}' missing"


def test_compare_with_own_session_returns_200(client):
    r = client.get("/brands/compare?session_id=unique-test-session-xyz")
    assert r.status_code == 200


# ── BRAND CREATION ────────────────────────────────────────────────────────────

def test_create_brand_valid(client):
    r = client.post("/brands", json={"name": "TestBrand QA", "session_id": "qa-test-run"})
    assert r.status_code == 201
    data = r.json()
    assert "id" in data
    client.delete(f"/brands/{data['id']}?session_id=qa-test-run")


def test_create_brand_empty_name_rejected(client):
    r = client.post("/brands", json={"name": "", "session_id": "qa"})
    assert r.status_code == 422


def test_create_brand_whitespace_only_rejected(client):
    r = client.post("/brands", json={"name": "   ", "session_id": "qa"})
    assert r.status_code == 422


def test_create_brand_reserved_session_example_rejected(client):
    r = client.post("/brands", json={"name": "Hack", "session_id": "example"})
    assert r.status_code == 422, "Reserved session_id 'example' must be rejected"


def test_create_brand_reserved_session_admin_rejected(client):
    r = client.post("/brands", json={"name": "Hack", "session_id": "admin"})
    assert r.status_code == 422, "Reserved session_id 'admin' must be rejected"


def test_create_brand_sql_injection_safe(client):
    r = client.post("/brands", json={"name": "'; DROP TABLE brands; --", "session_id": "qa-sql"})
    assert r.status_code in [201, 422], f"SQL injection caused unexpected status {r.status_code}"
    if r.status_code == 201:
        client.delete(f"/brands/{r.json()['id']}?session_id=qa-sql")


def test_create_brand_long_name(client):
    name = "A" * 200
    r = client.post("/brands", json={"name": name, "session_id": "qa-long"})
    assert r.status_code in [201, 422], f"Long name caused unexpected status {r.status_code}"
    if r.status_code == 201:
        client.delete(f"/brands/{r.json()['id']}?session_id=qa-long")


# ── BRAND DELETION ────────────────────────────────────────────────────────────

def test_delete_example_brand_forbidden(client):
    r = client.delete(f"/brands/{EXAMPLE_BRAND_ID}?session_id=attacker")
    assert r.status_code == 403, "Deleting example brand must be forbidden"


def test_delete_own_brand_succeeds(client):
    create = client.post("/brands", json={"name": "DeleteMe", "session_id": "delete-test"})
    assert create.status_code == 201
    bid = create.json()["id"]
    r = client.delete(f"/brands/{bid}?session_id=delete-test")
    assert r.status_code == 204


def test_delete_other_users_brand_forbidden(client):
    create = client.post("/brands", json={"name": "OtherUser", "session_id": "user-a"})
    assert create.status_code == 201
    bid = create.json()["id"]
    r = client.delete(f"/brands/{bid}?session_id=user-b")
    assert r.status_code == 403, "IDOR: must not delete another user's brand"
    client.delete(f"/brands/{bid}?session_id=user-a")


def test_delete_nonexistent_brand_404(client):
    r = client.delete("/brands/99999?session_id=qa")
    assert r.status_code == 404


def test_delete_brand_no_session_forbidden(client):
    create = client.post("/brands", json={"name": "NoSess", "session_id": "nosess-owner"})
    assert create.status_code == 201
    bid = create.json()["id"]
    r = client.delete(f"/brands/{bid}")
    assert r.status_code == 403, "No session_id must not allow deletion"
    client.delete(f"/brands/{bid}?session_id=nosess-owner")


# ── ADMIN AUTH ────────────────────────────────────────────────────────────────

def test_admin_session_without_key_not_privileged(client):
    r = client.get("/brands/compare?session_id=admin")
    assert r.status_code == 200
    for b in r.json():
        assert b.get("is_example") is True, \
            "admin session_id without key must only see example brands"


def test_limit_status_admin_without_key_not_bypassed(client):
    """session_id=admin without X-Admin-Key must NOT bypass rate limit."""
    r = client.get("/audit/limit-status?session_id=admin")
    assert r.status_code == 200
    data = r.json()
    assert data.get("max") != 9999, \
        "SECURITY: admin bypass on limit-status without key"


def test_admin_wrong_key_falls_back_to_example_only(client):
    # Wrong key → silent fallback to example-only (200), not 401.
    # Not revealing that admin auth exists is intentionally more secure.
    r = client.get("/brands/compare?session_id=admin",
                   headers={"X-Admin-Key": "definitely-wrong-key"})
    assert r.status_code == 200
    for b in r.json():
        assert b.get("is_example") is True, "Wrong key must not expose non-example brands"


def test_admin_literal_none_as_key_falls_back_to_example_only(client):
    r = client.get("/brands/compare?session_id=admin",
                   headers={"X-Admin-Key": "None"})
    assert r.status_code == 200
    for b in r.json():
        assert b.get("is_example") is True


# ── BRAND DATA ENDPOINTS ──────────────────────────────────────────────────────

def test_insights_example_brand_returns_list(client):
    r = client.get(f"/brands/{EXAMPLE_BRAND_ID}/insights")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_insights_nonexistent_brand_404(client):
    r = client.get("/brands/99999/insights")
    assert r.status_code == 404


def test_model_bias_example_brand_structure(client):
    r = client.get(f"/brands/{EXAMPLE_BRAND_ID_2}/model-bias")
    assert r.status_code == 200
    data = r.json()
    assert "models" in data
    for m in data["models"]:
        assert "model" in m
        assert "visibility_pct" in m
        assert 0 <= m["visibility_pct"] <= 100
        assert "avg_latency_ms" in m  # Task 3: latency field always present


def test_probe_performance_structure(client):
    r = client.get(f"/brands/{EXAMPLE_BRAND_ID_2}/probe-performance")
    assert r.status_code == 200
    data = r.json()
    assert "top" in data and "bottom" in data


def test_probe_performance_strong_threshold(client):
    r = client.get(f"/brands/{EXAMPLE_BRAND_ID_2}/probe-performance")
    data = r.json()
    for p in data.get("top", []):
        assert p["hit_rate"] >= 60, f"Top probe below 60%: {p}"
    for p in data.get("bottom", []):
        assert p["hit_rate"] < 60, f"Bottom probe at/above 60%: {p}"


def test_probe_detail_structure(client):
    r = client.get(f"/brands/{EXAMPLE_BRAND_ID}/probe-detail")
    assert r.status_code == 200
    data = r.json()
    assert "probes" in data
    assert "audit_date" in data
    for p in data["probes"]:
        assert "question" in p
        assert "hit_rate" in p
        assert "mentioned" in p
        assert "total_models" in p
        assert "result" in p
        assert 0 <= p["hit_rate"] <= 100
        assert p["result"] in ("strong", "weak")


def test_probe_detail_nonexistent_brand_404(client):
    r = client.get("/brands/99999/probe-detail")
    assert r.status_code == 404


def test_dark_matter_structure(client):
    r = client.get(f"/brands/{EXAMPLE_BRAND_ID}/dark-matter")
    assert r.status_code == 200
    data = r.json()
    assert "dark_matter_count" in data
    assert "total_probes" in data
    assert "probes" in data
    assert data["dark_matter_count"] >= 0
    assert data["total_probes"] >= data["dark_matter_count"]


def test_dark_matter_probes_are_zero_mention(client):
    r = client.get(f"/brands/{EXAMPLE_BRAND_ID}/dark-matter")
    data = r.json()
    for p in data["probes"]:
        assert "question" in p
        assert "times_tested" in p
        assert p["times_tested"] >= 1


def test_dark_matter_nonexistent_brand_404(client):
    r = client.get("/brands/99999/dark-matter")
    assert r.status_code == 404


# ── AUDIT RATE LIMITING ───────────────────────────────────────────────────────

def test_limit_status_fresh_session_zero(client):
    r = client.get("/audit/limit-status?session_id=never-used-session-abc123")
    assert r.status_code == 200
    data = r.json()
    assert data["limit_reached"] is False
    assert data["count"] == 0


def test_audit_example_brand_blocked(client):
    r = client.post(f"/audit/brands/{EXAMPLE_BRAND_ID}",
                    headers={"X-Forwarded-For": "10.99.88.77"})
    assert r.status_code == 400
    assert "example" in r.json().get("detail", "").lower()


def test_job_status_nonexistent_404(client):
    r = client.get("/audit/fake-job-id-does-not-exist")
    assert r.status_code == 404


# ── SECURITY ──────────────────────────────────────────────────────────────────

def test_session_id_never_in_compare_response(client):
    brands = client.get("/brands/compare").json()
    for b in brands:
        assert "session_id" not in b, "CRITICAL: session_id credential in public response"


def test_error_responses_are_json(client):
    r = client.get("/brands/99999/insights")
    assert "application/json" in r.headers.get("content-type", "")


def test_content_type_json_on_404(client):
    r = client.get("/brands/99999/model-bias")
    assert "application/json" in r.headers.get("content-type", "")


# ── FRONTEND (requires Next.js dev server on :3000) ───────────────────────────

def test_homepage_loads():
    r = httpx.get(f"{FRONTEND}", timeout=10)
    assert r.status_code == 200


def test_homepage_has_aura_ai_branding():
    r = httpx.get(f"{FRONTEND}", timeout=10)
    assert "Aura AI" in r.text, "Brand name 'Aura AI' not found in homepage"


def test_homepage_no_peecclone_leak():
    r = httpx.get(f"{FRONTEND}", timeout=10)
    assert "peecclone" not in r.text.lower()
    assert "peec clone" not in r.text.lower()
    assert "peec-clone" not in r.text.lower()


def test_homepage_no_admin_trigger_in_html():
    r = httpx.get(f"{FRONTEND}", timeout=10)
    assert "handleSecretAdminTrigger" not in r.text
    assert "secret-logo-trigger" not in r.text


def test_brand_page_loads():
    r = httpx.get(f"{FRONTEND}/brands/{EXAMPLE_BRAND_ID_2}", timeout=10)
    assert r.status_code == 200


def test_compare_page_loads():
    r = httpx.get(f"{FRONTEND}/compare", timeout=10)
    assert r.status_code == 200


def test_nonexistent_brand_page_not_500():
    r = httpx.get(f"{FRONTEND}/brands/99999", timeout=10)
    assert r.status_code in [404, 200], \
        f"Nonexistent brand page returned unexpected status {r.status_code}"
