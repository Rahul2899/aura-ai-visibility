"""Reasoning models bill hidden reasoning against the same max_tokens budget as the
visible answer. A flat 700-token probe cap was consumed entirely by Gemini's mandatory
reasoning: it returned ~111-character stubs where the other three models averaged
1300-1650, and an empty answer extracts to zero brands — a scored 0% that was an
artifact of the cap, not a measurement. These pin the headroom.
"""
import os

os.environ.setdefault("OPENROUTER_API_KEY", "test-key")

from src.llm.client import (
    PROBE_MAX_TOKENS,
    EXTRACT_MAX_TOKENS,
    REASONING_HEADROOM,
    REASONING_MANDATORY,
    DEFAULT_MODELS,
    ORCHESTRATOR_MODEL,
    probe_token_budget,
    extract_token_budget,
)


def test_extraction_is_capped():
    """Extraction ran uncapped and became the largest output in an audit — more tokens
    than all four probe models combined — because the reasoning model thinks before
    emitting a short JSON array."""
    budget = extract_token_budget(ORCHESTRATOR_MODEL)
    assert budget <= EXTRACT_MAX_TOKENS + REASONING_HEADROOM


def test_extraction_budget_fits_a_realistic_brand_list():
    """The first cap (500) truncated the JSON mid-object on longer answers: 11 of 40
    calls failed validation and a failed extraction scores the probe as "not mentioned".
    Measured answers name 5 brands on average, up to 7; each mention is ~60 tokens of
    JSON. The answer budget must clear a realistic list with margin, separately from
    whatever reasoning headroom the model gets."""
    TOKENS_PER_MENTION = 60
    assert EXTRACT_MAX_TOKENS >= 12 * TOKENS_PER_MENTION


def test_mandatory_reasoning_models_get_headroom():
    """Without this the reasoning eats the answer and the probe scores a false 0%."""
    for model in REASONING_MANDATORY:
        assert probe_token_budget(model) == PROBE_MAX_TOKENS + REASONING_HEADROOM


def test_other_models_keep_the_tight_budget():
    """Headroom is not free — it raises the ceiling on what a rambling model can bill.
    Only models that need it should get it."""
    assert probe_token_budget("anthropic/claude-haiku-4.5") == PROBE_MAX_TOKENS
    assert probe_token_budget("openai/gpt-5.4-mini") == PROBE_MAX_TOKENS


def test_every_panel_model_has_room_for_a_real_answer():
    """Observed probe answers run ~1300-1650 chars (~350-450 tokens). Whatever the
    per-model rule, the budget must clear that with margin or answers get truncated."""
    for model in DEFAULT_MODELS:
        assert probe_token_budget(model) >= 700


def test_gemini_is_covered():
    """The specific regression: Gemini 3.x rejects reasoning.enabled=false, so it can
    only be handled with headroom. If it's dropped from the set, this fails."""
    gemini = [m for m in DEFAULT_MODELS if "gemini" in m]
    assert gemini, "panel has no Gemini model — update this test if that's intentional"
    for m in gemini:
        assert probe_token_budget(m) > PROBE_MAX_TOKENS
