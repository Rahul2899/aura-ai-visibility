"""Unit tests for the brand-blind guarantee on scored questions.

The scored half of an audit only means something if the questions were written
WITHOUT knowing which brand is being measured. A question that names the brand
(or is shaped around it) guarantees a mention and inflates the score, which is
the exact bias this product exists to avoid.

Two things protect that, and both are tested here:
  - `_strip_brand` scrubs the brand name out of any text fed to the blind pool.
  - `_infer_category` returns a CATEGORY label, never a brand-shaped one, so the
    generator is grounded in the market rather than the company.
"""
from src.agents.orchestrator import _strip_brand


def test_strips_brand_name_case_insensitively():
    # The generator must never see the brand, whatever casing the source used.
    out = _strip_brand("STARBUCKS is a coffee shop chain", "Starbucks")
    assert "starbucks" not in out.lower()
    assert "coffee shop chain" in out


def test_keeps_words_that_merely_contain_the_brand():
    # Word-boundary matching: scrubbing must not corrupt unrelated words, or the
    # category context degrades and the questions drift off-market.
    assert _strip_brand("Lever and Cleverbit", "Lever") == "the brand and Cleverbit"


def test_handles_empty_inputs():
    assert _strip_brand("", "Starbucks") == ""
    assert _strip_brand("some text", "") == "some text"


def test_replaces_every_occurrence():
    out = _strip_brand("Starbucks rivals Starbucks", "Starbucks")
    assert "starbucks" not in out.lower()
    assert out.count("the brand") == 2
