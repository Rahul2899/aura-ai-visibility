"""Unit tests for extract_page_signal — the homepage-scrape quality improvement."""
from src.agents.orchestrator import extract_page_signal

SAMPLE = """
<html><head>
<title>Workday - Enterprise HR and Finance</title>
<meta name="description" content="Workday delivers HCM, payroll, and financial management.">
</head><body>
<nav>Home About Login Pricing</nav>
<h1>The finance and HR system for a changing world</h1>
<h2>Payroll, workforce planning, and analytics</h2>
<script>var tracking = 1;</script>
<style>.x{color:red}</style>
</body></html>
"""


def test_extracts_title():
    out = extract_page_signal(SAMPLE)
    assert "Workday - Enterprise HR and Finance" in out


def test_extracts_meta_description():
    out = extract_page_signal(SAMPLE)
    assert "HCM, payroll" in out


def test_extracts_headings():
    out = extract_page_signal(SAMPLE)
    assert "changing world" in out
    assert "workforce planning" in out


def test_drops_script_and_style_content():
    out = extract_page_signal(SAMPLE)
    assert "tracking" not in out
    assert "color:red" not in out


def test_falls_back_to_body_when_no_structured_signal():
    html = "<html><body><div>Some plain product copy here describing things.</div></body></html>"
    out = extract_page_signal(html)
    assert "product copy" in out


def test_empty_html_returns_empty():
    assert extract_page_signal("<html></html>") == ""


def test_uses_og_description_when_meta_missing():
    html = '<html><head><meta property="og:description" content="OG fallback text"></head><body></body></html>'
    out = extract_page_signal(html)
    assert "OG fallback text" in out


def test_caps_length():
    html = "<html><body>" + ("word " * 1000) + "</body></html>"
    out = extract_page_signal(html)
    assert len(out) <= 1500
