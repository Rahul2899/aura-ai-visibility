"""The shim translates Bedrock's converse() wire shape to/from OpenRouter's.
If that translation breaks, every orchestrator call (questions, category, analysis,
recommendations, entity check) silently fails. These tests pin both directions.
"""
import os

import httpx
import pytest

os.environ.setdefault("OPENROUTER_API_KEY", "test-key")

from src.llm.bedrock_client import ConverseShim, REASONING_HEADROOM


def _capture(monkeypatch, reply="hello"):
    """Stub httpx.post; return the dict the shim would have sent."""
    sent = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        sent.update(json)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": reply}}],
                  "usage": {"prompt_tokens": 11, "completion_tokens": 22}},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    return sent


def test_system_and_content_blocks_are_flattened(monkeypatch):
    sent = _capture(monkeypatch)
    ConverseShim().converse(
        modelId="m",
        system=[{"text": "be terse"}],
        messages=[{"role": "user", "content": [{"text": "hi"}]}],
        inferenceConfig={"maxTokens": 50, "temperature": 0.2},
    )
    # Bedrock's [{"text": ...}] blocks must become plain strings, system first.
    assert sent["messages"] == [
        {"role": "system", "content": "be terse"},
        {"role": "user", "content": "hi"},
    ]
    # Reasoning models bill hidden reasoning against the same budget as the visible
    # answer, so the shim adds headroom on top of the caller's answer budget. Without
    # it, a small cap is spent thinking and the reply arrives truncated mid-JSON.
    assert sent["max_tokens"] == 50 + REASONING_HEADROOM
    assert sent["temperature"] == 0.2


def test_response_matches_bedrock_shape(monkeypatch):
    _capture(monkeypatch, reply='{"match": true}')
    resp = ConverseShim().converse(
        modelId="m", messages=[{"role": "user", "content": [{"text": "hi"}]}]
    )
    # Exactly the path every orchestrator call site indexes into.
    assert resp["output"]["message"]["content"][0]["text"] == '{"match": true}'
    assert resp["usage"]["inputTokens"] == 11
    assert resp["usage"]["outputTokens"] == 22


def test_system_omitted_when_absent(monkeypatch):
    sent = _capture(monkeypatch)
    ConverseShim().converse(
        modelId="m", messages=[{"role": "user", "content": [{"text": "hi"}]}]
    )
    assert sent["messages"] == [{"role": "user", "content": "hi"}]
    # No inferenceConfig -> don't invent limits; let the model default.
    assert "max_tokens" not in sent and "temperature" not in sent


def test_missing_api_key_fails_fast(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="OPENROUTER_API_KEY"):
        ConverseShim()
