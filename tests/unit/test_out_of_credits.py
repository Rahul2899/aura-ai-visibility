"""A spent OpenRouter balance returns HTTP 402. Two things must hold, or a demo turns
into a wrong number or an apparent crash: the client must not retry it (402 never
self-heals, and backing off on every call makes an audit hang before it dies), and a
probe must not swallow it (failed probes are dropped from the score, so absorbing it
would publish a visibility % computed from however many probes ran before the money
ran out).
"""
import os

import httpx
import pytest

os.environ.setdefault("OPENROUTER_API_KEY", "test-key")

from src.agents.orchestrator import _probe_one_model
from src.llm.client import OpenRouterClient, OutOfCreditsError


def _client_returning(monkeypatch, status):
    """Stub the client's HTTP POST with a fixed status; count the attempts made."""
    calls = {"n": 0}
    client = OpenRouterClient()

    async def fake_post(url, headers=None, json=None):
        calls["n"] += 1
        return httpx.Response(
            status,
            json={"error": {"message": "Insufficient credits"}},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(client.http, "post", fake_post)
    return client, calls


@pytest.mark.asyncio
async def test_402_raises_out_of_credits_without_retrying(monkeypatch):
    client, calls = _client_returning(monkeypatch, 402)

    with pytest.raises(OutOfCreditsError):
        await client.complete(model="openai/gpt-5.4-mini", messages=[{"role": "user", "content": "hi"}])

    assert calls["n"] == 1, "402 must fail on the first attempt, not burn the retry budget"


@pytest.mark.asyncio
async def test_other_http_errors_still_retry(monkeypatch):
    """Guard against over-broad matching: a 500 is transient and must still retry."""
    client, calls = _client_returning(monkeypatch, 500)

    with pytest.raises(httpx.HTTPStatusError):
        await client.complete(
            model="openai/gpt-5.4-mini",
            messages=[{"role": "user", "content": "hi"}],
            max_retries=2,
        )

    assert calls["n"] == 2


@pytest.mark.asyncio
async def test_probe_propagates_out_of_credits(monkeypatch):
    """The probe's blanket `except Exception` marks failures as skippable. Out-of-credits
    must escape it so the audit aborts instead of scoring a partial panel."""
    async def boom(self, **kwargs):
        raise OutOfCreditsError("out of credits")

    monkeypatch.setattr(OpenRouterClient, "complete", boom)

    with pytest.raises(OutOfCreditsError):
        await _probe_one_model("openrouter", "openai/gpt-5.4-mini", "prompt", "Acme")


@pytest.mark.asyncio
async def test_probe_still_swallows_ordinary_errors(monkeypatch):
    """The abort above must be narrow: a normal model error stays a skipped probe."""
    async def boom(self, **kwargs):
        raise RuntimeError("model hiccup")

    monkeypatch.setattr(OpenRouterClient, "complete", boom)

    result = await _probe_one_model("openrouter", "openai/gpt-5.4-mini", "prompt", "Acme")
    assert result["failed"] is True
