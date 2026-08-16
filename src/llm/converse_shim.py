"""Compatibility shim kept only so the orchestrator's existing call sites keep working.

The app used to call AWS Bedrock's `client.converse(...)` directly in five places.
Rather than rewrite those five call sites (and their response parsing), this module
re-implements that exact request/response *shape* on top of OpenRouter. Nothing here
talks to AWS — boto3 is gone.

`converse()` is synchronous by design: the orchestrator wraps every call in
`asyncio.to_thread(...)`, so it must block, like the boto3 method it replaces.
"""

import os
import time

import httpx
import structlog
from dotenv import load_dotenv

from src.llm.client import OPENROUTER_BASE, OutOfCreditsError

# Headroom for reasoning models, which bill hidden reasoning tokens against the SAME
# max_tokens budget as the visible answer. Call sites size maxTokens for the answer
# alone, so without headroom the budget is spent thinking and the reply arrives
# truncated mid-JSON. Gemini 3.x mandates reasoning and cannot opt out.
# Applied as "answer budget + fixed headroom" rather than a flat floor: a flat floor
# rescued the 30-token category call but still truncated the 1400-token
# recommendations call, which needs its full answer budget AND room to think.
REASONING_HEADROOM = 800

load_dotenv()
log = structlog.get_logger()


class ConverseShim:
    """Exposes `.converse(modelId=..., system=[...], messages=[...], inferenceConfig={...})`
    and returns `{"output": {"message": {"content": [{"text": ...}]}}, "usage": {...}}` —
    the Bedrock wire shape the orchestrator already parses."""

    def __init__(self):
        key = os.environ.get("OPENROUTER_API_KEY")
        if not key:
            raise RuntimeError("OPENROUTER_API_KEY is not set. Add it to .env (get a key at https://openrouter.ai/keys).")
        self.api_key = key

    def converse(self, modelId: str, messages: list[dict], system: list[dict] | None = None,
                 inferenceConfig: dict | None = None, max_retries: int = 3) -> dict:
        cfg = inferenceConfig or {}
        payload: dict = {
            "model": modelId,
            # Bedrock nests text in content blocks; OpenAI-style wants a plain string.
            "messages": (
                [{"role": "system", "content": " ".join(s["text"] for s in system)}] if system else []
            ) + [
                {"role": m["role"], "content": " ".join(c["text"] for c in m["content"])}
                for m in messages
            ],
        }
        if "maxTokens" in cfg:
            payload["max_tokens"] = cfg["maxTokens"] + REASONING_HEADROOM
        if "temperature" in cfg:
            payload["temperature"] = cfg["temperature"]

        headers = {"Authorization": f"Bearer {self.api_key}", "HTTP-Referer": "https://aurai.duckdns.org"}

        last_err: Exception | None = None
        for attempt in range(max_retries):
            t0 = time.monotonic()
            try:
                resp = httpx.post(
                    f"{OPENROUTER_BASE}/chat/completions",
                    headers=headers, json=payload, timeout=90,
                )
                if resp.status_code == 429:
                    time.sleep(2 ** attempt)
                    continue
                # Same credit/budget stop as OpenRouterClient. The orchestration calls
                # run through this shim, so without it an exhausted account surfaced as
                # a raw "403 Forbidden" mid-audit instead of "out of credits".
                if resp.status_code == 402 or (
                    resp.status_code == 403 and "budget" in (resp.text or "").lower()
                ):
                    log.warning("out_of_credits", model=modelId, status=resp.status_code)
                    raise OutOfCreditsError(
                        "OpenRouter is not accepting requests: credits are spent or the "
                        "account's spend limit was reached. Check https://openrouter.ai/credits "
                        "and the monthly limit in account settings."
                    )
                resp.raise_for_status()
                data = resp.json()
                usage = data.get("usage", {})
                log.info(
                    "llm_call", provider="openrouter", model=modelId,
                    latency_ms=int((time.monotonic() - t0) * 1000),
                    tokens_in=usage.get("prompt_tokens"), tokens_out=usage.get("completion_tokens"),
                )
                return {
                    "output": {"message": {"content": [{"text": data["choices"][0]["message"]["content"]}]}},
                    "usage": {
                        "inputTokens": usage.get("prompt_tokens"),
                        "outputTokens": usage.get("completion_tokens"),
                    },
                }
            except OutOfCreditsError:
                raise  # not transient: retrying just delays the same failure
            except Exception as e:
                last_err = e
                if attempt == max_retries - 1:
                    raise
                log.warning("openrouter_error", error=str(e), attempt=attempt)
                time.sleep(2 ** attempt)

        raise RuntimeError(f"OpenRouter converse failed after {max_retries} attempts: {last_err}")
