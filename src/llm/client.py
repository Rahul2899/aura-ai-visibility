import asyncio
import os
import time
import httpx
import structlog
from dotenv import load_dotenv

load_dotenv()
log = structlog.get_logger()

OPENROUTER_BASE = "https://openrouter.ai/api/v1"

# The probe panel: the four assistants real buyers actually ask before they buy.
# Four DIFFERENT vendors so "cross-model visibility" is a credible measurement rather
# than one lab's opinion sampled four times. Swapping a model is a string change here,
# not a client rewrite.
#
# Sized deliberately: these are the small/fast tier of each family, but NOT the nano
# tier. Nano models genuinely don't know mid-size brands, which reads as "invisible"
# when it's really just a thin model — a measurement artifact we don't want.
#
# These are paid (no `:free` suffix): roughly $0.06-0.10 per audit all-in. Keep
# GLOBAL_DAILY_AUDIT_CAP in .env low enough that the credit balance can absorb a day.
DEFAULT_MODELS: list[str] = [
    "openai/gpt-5.4-mini",        # OpenAI
    "google/gemini-3.7-flash",    # Google
    "x-ai/grok-4.3",              # xAI
    "anthropic/claude-haiku-4.5", # Anthropic
]

# Single model for the orchestration roles (question generation, category inference,
# analysis, entity verification). These are single-model jobs where vendor diversity
# buys nothing, so we use the cheapest capable panel model and keep orchestration at
# roughly 15% of the spend.
ORCHESTRATOR_MODEL = "google/gemini-3.7-flash"
QUESTION_MODEL = "google/gemini-3.7-flash"

# Models where reasoning is billed as output tokens AND can be turned off. A probe
# should capture the model's plain first answer (what a real user sees), and reasoning
# is pure cost here: on Grok 4.3 a short probe went 381 output tokens -> 74 with it off.
# NOT a blanket setting — some endpoints (Gemini 3.x) reject `reasoning.enabled=false`
# outright with HTTP 400 "Reasoning mandatory for endpoint", so only list models
# verified to accept it.
REASONING_OPTIONAL: frozenset[str] = frozenset({
    "x-ai/grok-4.3",
})


class OpenRouterClient:
    def __init__(self):
        key = os.environ.get("OPENROUTER_API_KEY")
        if not key:
            raise RuntimeError("OPENROUTER_API_KEY is not set. Add it to .env (get a key at https://openrouter.ai/keys).")
        self.api_key = key
        self.http = httpx.AsyncClient(timeout=90)

    async def complete(self, model: str, messages: list[dict], max_retries: int = 3,
                       max_tokens: int | None = None, temperature: float | None = None) -> dict:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "HTTP-Referer": "https://aura-ai.app",
        }
        payload: dict = {"model": model, "messages": messages}
        if model in REASONING_OPTIONAL:
            payload["reasoning"] = {"enabled": False}
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        if temperature is not None:
            payload["temperature"] = temperature

        for attempt in range(max_retries):
            t0 = time.monotonic()
            try:
                resp = await self.http.post(
                    f"{OPENROUTER_BASE}/chat/completions",
                    headers=headers,
                    json=payload,
                )
                latency_ms = int((time.monotonic() - t0) * 1000)

                if resp.status_code == 429:
                    wait = 2 ** attempt
                    log.warning("rate_limited", model=model, attempt=attempt, wait=wait)
                    await asyncio.sleep(wait)
                    continue

                resp.raise_for_status()
                data = resp.json()
                usage = data.get("usage", {})

                log.info(
                    "llm_call",
                    provider="openrouter",
                    model=model,
                    latency_ms=latency_ms,
                    tokens_in=usage.get("prompt_tokens"),
                    tokens_out=usage.get("completion_tokens"),
                )
                return {
                    "text": data["choices"][0]["message"]["content"],
                    "latency_ms": latency_ms,
                    "tokens_in": usage.get("prompt_tokens"),
                    "tokens_out": usage.get("completion_tokens"),
                    "provider": "openrouter",
                }

            except httpx.HTTPStatusError as e:
                if attempt == max_retries - 1:
                    raise
                wait = 2 ** attempt
                log.warning("http_error", status=e.response.status_code, attempt=attempt, wait=wait)
                await asyncio.sleep(wait)

        raise RuntimeError(f"OpenRouter call failed after {max_retries} attempts")

    async def close(self):
        await self.http.aclose()
