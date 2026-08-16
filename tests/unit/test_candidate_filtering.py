"""A company-name search returns the company's own site mixed with pages that write
about it. Picking a write-up sets the brand's domain to that publisher and the audit
reads the wrong company: finance.yahoo.com made the inferred category "finance", and
marketermilk.com/blog/peec-ai made it "marketing news platform".

Deciding which is which is _classify_candidates' job — it reads the page content, so it
generalises to publishers nobody listed. group_candidates stays deterministic: it groups
by domain and drops only the handful of hosts that are structurally never a company's
own site. These tests cover that deterministic half.
"""
import os

os.environ.setdefault("OPENROUTER_API_KEY", "test-key")

from src.agents.orchestrator import group_candidates, _is_company_site


def _result(url, title):
    return {"url": url, "title": title, "content": "..."}


def test_groups_one_candidate_per_domain():
    """Search returns several pages from the same site; they are one entity, not many."""
    results = [
        _result("https://acme.de/", "Acme GmbH"),
        _result("https://acme.de/about", "About Acme"),
        _result("https://acme.co/", "Acme Inc"),
    ]
    assert [c["domain"] for c in group_candidates(results)] == ["acme.de", "acme.co"]


def test_structural_non_companies_are_dropped():
    """Social networks, encyclopedias and job boards are never a company's own domain,
    so they're skipped before spending a classifier call on them."""
    results = [
        _result("https://www.linkedin.com/company/acme", "Acme | LinkedIn"),
        _result("https://en.wikipedia.org/wiki/Acme", "Acme - Wikipedia"),
        _result("https://acme.de/", "Acme GmbH"),
    ]
    assert [c["domain"] for c in group_candidates(results)] == ["acme.de"]


def test_publishers_are_left_for_the_content_check():
    """A news site CAN be the subject of an audit (Forbes is a real company), so the
    deny-list must not judge it. Whether a given page is the brand's own site is decided
    from content downstream, not from the domain here."""
    results = [
        _result("https://finance.yahoo.com/news/peec-ai-raises", "PEEC AI raises"),
        _result("https://peec.ai/", "PEEC AI"),
    ]
    domains = [c["domain"] for c in group_candidates(results)]
    assert "peec.ai" in domains
    assert "finance.yahoo.com" in domains


def test_genuine_namesakes_both_survive():
    """Two real companies sharing a name are what the picker exists for."""
    results = [
        _result("https://www.lever.co/", "Lever - Recruiting Software"),
        _result("https://lever.de/", "Lever GmbH - Maschinenbau"),
    ]
    assert [c["domain"] for c in group_candidates(results)] == ["lever.co", "lever.de"]


def test_subdomains_of_listed_hosts_are_caught():
    """_registrable_domain keeps subdomains, so the check walks parent suffixes."""
    assert not _is_company_site("en.wikipedia.org")
    assert not _is_company_site("de.linkedin.com")


def test_company_subdomains_are_kept():
    """A brand's own subdomain is still the brand, and a multi-part ccTLD is not a
    listed host."""
    assert _is_company_site("shop.mybrand.com")
    assert _is_company_site("mybrand.co.uk")
