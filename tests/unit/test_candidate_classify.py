"""Which search result is the brand's OWN site is decided from page content, not from
the domain. Three attempts at deciding it from the URL failed on the next real case: a
hand-maintained deny-list missed finance.yahoo.com, brand-name matching rejected real
companies whose domain doesn't carry their name, and URL depth still let a blog root
through. Picking wrong sets brand.domain to a publisher, and the audit reads that
company instead — the categories "finance" and "marketing news platform" both came from
this.

The classifier itself is a model call; these pin the contract around it — what it is
asked, and that neither an outage nor a reject-everything answer can strand a brand
with no candidates.
"""
import asyncio
import json
import os

os.environ.setdefault("OPENROUTER_API_KEY", "test-key")

from src.agents.orchestrator import _classify_candidates


class FakeLLM:
    """Returns a fixed set of 'official' indices and records the prompt it was sent."""

    def __init__(self, official):
        self.official = official
        self.prompt = ""

    def converse(self, **kwargs):
        self.prompt = kwargs["messages"][0]["content"][0]["text"]
        return {"output": {"message": {"content": [{"text": json.dumps({"official": self.official})}]}}}


class BrokenLLM:
    def converse(self, **kwargs):
        raise RuntimeError("upstream down")


CANDIDATES = [
    {"domain": "marketermilk.com", "title": "Peec AI Review",
     "description": "We reviewed Peec AI, a tool that tracks brand visibility."},
    {"domain": "peec.ai", "title": "Peec AI",
     "description": "Track how AI models recommend your brand. Start free."},
]


def test_keeps_only_what_the_model_calls_official():
    llm = FakeLLM([1])
    out = asyncio.run(_classify_candidates(llm, "PeecAI", CANDIDATES))
    assert [c["domain"] for c in out] == ["peec.ai"]


def test_the_model_is_given_the_page_content():
    """The whole point is judging by content — if the snippet isn't in the prompt, the
    classifier is back to guessing from domains."""
    llm = FakeLLM([1])
    asyncio.run(_classify_candidates(llm, "PeecAI", CANDIDATES))
    assert "Track how AI models recommend your brand" in llm.prompt
    assert "We reviewed Peec AI" in llm.prompt


def test_classifier_outage_does_not_strand_the_brand():
    """Filtering is an improvement on the ranking, not a gate. If the call fails the
    user must still get the search results."""
    out = asyncio.run(_classify_candidates(BrokenLLM(), "PeecAI", CANDIDATES))
    assert [c["domain"] for c in out] == ["marketermilk.com", "peec.ai"]


def test_rejecting_everything_returns_no_selectable_sites():
    """Publisher links must not reappear in the picker after the model rejects them."""
    out = asyncio.run(_classify_candidates(FakeLLM([]), "PeecAI", CANDIDATES))
    assert out == []


def test_the_models_ranking_is_preserved():
    """Big brands own several sites. Kaufland is a hypermarket chain, but the audit
    picked kaufland-ecommerce.com — a real Kaufland site, wrong business unit — and
    scored the chain against online marketplaces at 6.2%. The model is asked to put the
    brand's MAIN site first, and when one candidate survives the caller adopts it, so
    that order must not be re-sorted back into search-engine order."""
    results = [
        {"domain": "kaufland-ecommerce.com", "title": "Kaufland Marketplace",
         "description": "Sell on our online marketplace."},
        {"domain": "kaufland.de", "title": "Kaufland",
         "description": "Your hypermarket. Weekly offers, find a store near you."},
    ]
    llm = FakeLLM([1, 0])  # main site first, business unit second
    out = asyncio.run(_classify_candidates(llm, "Kaufland", results))
    assert [c["domain"] for c in out] == ["kaufland.de", "kaufland-ecommerce.com"]


def test_empty_input_needs_no_model_call():
    llm = FakeLLM([0])
    assert asyncio.run(_classify_candidates(llm, "PeecAI", [])) == []
    assert llm.prompt == "", "no results means nothing to classify"
