"""A company-name search ranks LinkedIn/Crunchbase/Wikipedia above the company's own
site. Each of those used to become a disambiguation candidate carrying the ARTICLE's
title, so the picker showed the right company name against an aggregator's domain —
selecting it set brand.domain to linkedin.com and audited LinkedIn's homepage. These
pin the filter, and equally that it doesn't swallow real same-name companies.
"""
import os

os.environ.setdefault("OPENROUTER_API_KEY", "test-key")

from src.agents.orchestrator import group_candidates, _is_company_site


def _result(url, title):
    return {"url": url, "title": title, "content": "..."}


def test_aggregators_are_not_offered_as_candidates():
    results = [
        _result("https://www.linkedin.com/company/acme-gmbh", "Acme GmbH | LinkedIn"),
        _result("https://acme.de/", "Acme GmbH – Startseite"),
        _result("https://www.crunchbase.com/organization/acme", "Acme GmbH - Crunchbase"),
        _result("https://en.wikipedia.org/wiki/Acme", "Acme GmbH - Wikipedia"),
    ]
    domains = [c["domain"] for c in group_candidates(results)]
    assert domains == ["acme.de"]


def test_single_company_across_many_pages_is_not_ambiguous():
    """Ambiguity is `len(candidates) >= 2`. Aggregator rows inflated that count and
    prompted 'which one do you mean?' when the search found exactly one company."""
    results = [
        _result("https://www.linkedin.com/company/acme", "Acme GmbH | LinkedIn"),
        _result("https://acme.de/", "Acme GmbH"),
        _result("https://de.linkedin.com/in/founder", "Acme founder"),
    ]
    assert len(group_candidates(results)) < 2


def test_genuine_namesakes_still_prompt():
    """The filter must not over-reach: two real companies sharing a name are exactly
    what the picker exists for."""
    results = [
        _result("https://www.linkedin.com/company/lever", "Lever | LinkedIn"),
        _result("https://www.lever.co/", "Lever - Recruiting Software"),
        _result("https://lever.de/", "Lever GmbH - Maschinenbau"),
    ]
    domains = [c["domain"] for c in group_candidates(results)]
    assert domains == ["lever.co", "lever.de"]


def test_subdomains_of_aggregators_are_caught():
    """_registrable_domain keeps subdomains, so the check walks parent suffixes."""
    assert not _is_company_site("en.wikipedia.org")
    assert not _is_company_site("de.linkedin.com")


def test_news_site_about_the_brand_is_not_the_brand():
    """The real regression: a Yahoo Finance article about PEEC AI passed the deny-list
    (yahoo.com wasn't on it), was picked from the candidate list, and the audit scraped
    finance.yahoo.com — so the inferred category came back "finance"."""
    results = [
        _result("https://finance.yahoo.com/news/peec-ai-raises", "PEEC AI raises funding"),
        _result("https://peec.ai/", "PEEC AI"),
        _result("https://techcrunch.com/2026/peec-ai", "PEEC AI launches"),
    ]
    domains = [c["domain"] for c in group_candidates(results, brand_name="peecai")]
    assert domains == ["peec.ai"]


def test_name_match_generalises_beyond_the_deny_list():
    """A deny-list only catches sites someone listed. When the brand name is known, a
    domain that doesn't carry it is treated as writing about the company."""
    assert not _is_company_site("someblog.example", brand_name="peecai")
    assert _is_company_site("peec.ai", brand_name="peecai")


def test_unlisted_site_survives_when_nothing_matches_the_name():
    """Real companies do have domains without their name (rebrands, acronyms, parent
    companies). Those must not vanish — they're kept as a fallback when the name-matching
    pass finds nothing."""
    results = [
        _result("https://parentcorp.com/", "Obscure Co - a ParentCorp brand"),
    ]
    domains = [c["domain"] for c in group_candidates(results, brand_name="ObscureCo")]
    assert domains == ["parentcorp.com"]


def test_company_subdomains_are_kept():
    """Guard against matching too broadly — a brand's own subdomain is still the brand,
    and a multi-part ccTLD must not be mistaken for an aggregator."""
    assert _is_company_site("shop.mybrand.com")
    assert _is_company_site("mybrand.co.uk")
