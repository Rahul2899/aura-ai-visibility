"""Deterministic disambiguation: grouping search results into distinct entities."""
from src.agents.orchestrator import group_candidates, _registrable_domain


def test_registrable_domain_strips_everything():
    assert _registrable_domain("https://www.fitstar.de/en/home?x=1") == "fitstar.de"
    assert _registrable_domain("http://fitstar.de") == "fitstar.de"
    assert _registrable_domain("FitStar.DE:443") == "fitstar.de"


def test_two_distinct_entities():
    results = [
        {"url": "https://fitstar.de", "title": "FIT STAR Gym", "content": "22 studios"},
        {"url": "https://fitbit.com/fitstar", "title": "FitStar App", "content": "workout app"},
    ]
    cands = group_candidates(results)
    assert len(cands) == 2
    assert {c["domain"] for c in cands} == {"fitstar.de", "fitbit.com"}


def test_same_domain_collapses_to_one():
    results = [
        {"url": "https://fitstar.de/", "title": "Home", "content": "gym"},
        {"url": "https://www.fitstar.de/studios", "title": "Studios", "content": "locations"},
    ]
    cands = group_candidates(results)
    assert len(cands) == 1
    assert cands[0]["domain"] == "fitstar.de"


def test_first_result_per_domain_wins():
    results = [
        {"url": "https://acme.com/a", "title": "First", "content": "one"},
        {"url": "https://acme.com/b", "title": "Second", "content": "two"},
    ]
    cands = group_candidates(results)
    assert len(cands) == 1
    assert cands[0]["title"] == "First"


def test_empty_results():
    assert group_candidates([]) == []
