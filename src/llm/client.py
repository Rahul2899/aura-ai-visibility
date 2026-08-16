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
# These are paid (no `:free` suffix). Measure real spend on openrouter.ai/activity
# before assuming a per-audit figure — an early estimate here was off by ~5x because
# extraction was running on the probe model. Keep GLOBAL_DAILY_AUDIT_CAP in .env low
# enough that the credit balance can absorb a day.
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

# A probe answer is a buyer-style recommendation list; past ~700 tokens the model is
# padding, and we pay for every token of it. Applied to probes only — the orchestration
# calls size their own budgets, some of which legitimately need more.
PROBE_MAX_TOKENS = 700

# Models that reason unavoidably: hidden reasoning bills against the SAME max_tokens
# budget as the visible answer, and these endpoints reject reasoning.enabled=false.
# A flat 700 cap was spent entirely on Gemini's reasoning — it returned ~111-character
# stubs where the other three averaged 1300-1650, scoring 0% visibility. That was a
# measurement artifact created by the cap, not a real result. Headroom is added ON TOP
# of the answer budget, the same fix ConverseShim uses for the orchestration calls.
# Only list models observed to need it; unused budget costs nothing, but a wrong entry
# here hides a genuine truncation.
REASONING_MANDATORY: frozenset[str] = frozenset({
    "google/gemini-3.7-flash",
})
REASONING_HEADROOM = 800


def probe_token_budget(model: str) -> int:
    """max_tokens for one probe: the answer budget, plus room to think for models that
    can't be told not to. Without the headroom the reasoning eats the answer."""
    return PROBE_MAX_TOKENS + (REASONING_HEADROOM if model in REASONING_MANDATORY else 0)


# Extraction returns a short JSON array of brand names — a few hundred tokens even for a
# long answer. It ran uncapped and became the single largest output in an audit (more
# than all four probe models combined) because the reasoning model thinks before
# emitting JSON. Same headroom rule: room to reason, then a bounded answer.
EXTRACT_MAX_TOKENS = 500


def extract_token_budget(model: str) -> int:
    """max_tokens for one extraction call."""
    return EXTRACT_MAX_TOKENS + (REASONING_HEADROOM if model in REASONING_MANDATORY else 0)


class OutOfCreditsError(RuntimeError):
    """OpenRouter returned 402 — the account balance is spent. Distinct from a transient
    HTTP failure so callers can tell the user the budget ran out, not that the app broke."""


class OpenRouterClient:
    def __init__(self):
        key = os.environ.get("OPENROUTER_API_KEY")
        if not key:
            raise RuntimeError("OPENROUTER_API_KEY is not set. Add it to .env (get a key at https://openrouter.ai/keys).")
        self.api_key = key
        self.http = httpx.AsyncClient(timeout=90)
        # Running totals for every call this client made. Lets a caller report usage for
        # helper calls (extraction) it doesn't get a usage dict back from, without
        # changing those helpers' return types.
        self.usage = {"calls": 0, "tokens_in": 0, "tokens_out": 0, "latency_ms": 0}

    async def complete(self, model: str, messages: list[dict], max_retries: int = 3,
                       max_tokens: int | None = None, temperature: float | None = None) -> dict:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "HTTP-Referer": "https://mapthemodel.duckdns.org",
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
                self.usage["calls"] += 1
                self.usage["tokens_in"] += usage.get("prompt_tokens") or 0
                self.usage["tokens_out"] += usage.get("completion_tokens") or 0
                self.usage["latency_ms"] += latency_ms
                return {
                    "text": data["choices"][0]["message"]["content"],
                    "latency_ms": latency_ms,
                    "tokens_in": usage.get("prompt_tokens"),
                    "tokens_out": usage.get("completion_tokens"),
                    "provider": "openrouter",
                }

            except httpx.HTTPStatusError as e:
                # 402 means the account balance is spent. Retrying can't fix that, and
                # backing off 3x per call turns a whole audit into a slow hang before it
                # fails. Raise a distinct type so the API layer can report "out of
                # credits" rather than leaking a raw HTTP error to the user.
                if e.response.status_code == 402:
                    log.warning("out_of_credits", model=model)
                    raise OutOfCreditsError(
                        "OpenRouter account is out of credits. Top up at https://openrouter.ai/credits."
                    ) from e
                if attempt == max_retries - 1:
                    raise
                wait = 2 ** attempt
                log.warning("http_error", status=e.response.status_code, attempt=attempt, wait=wait)
                await asyncio.sleep(wait)

        raise RuntimeError(f"OpenRouter call failed after {max_retries} attempts")

    async def close(self):
        await self.http.aclose()
