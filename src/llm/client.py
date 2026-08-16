import asyncio
import os
import time
import httpx
import structlog
from dotenv import load_dotenv

load_dotenv()
log = structlog.get_logger()

OPENROUTER_BASE = "https://openrouter.ai/api/v1"

# The probe panel. Four DIFFERENT model families so "cross-model visibility" is a
# credible measurement rather than one vendor's opinion sampled four times.
# All are OpenRouter `:free` variants — no card needed, and no cloud-provider lock-in:
# swapping a model is a string change here, not a client rewrite.
# Free tier is rate-limited (~50 req/day; ~1000/day once the account has any credit),
# so GLOBAL_DAILY_AUDIT_CAP in .env should stay low unless you top up.
DEFAULT_MODELS: list[str] = [
    "deepseek/deepseek-chat-v3.1:free",              # DeepSeek
    "meta-llama/llama-3.3-70b-instruct:free",        # Meta
    "qwen/qwen3-235b-a22b:free",                     # Qwen / Alibaba
    "mistralai/mistral-small-3.2-24b-instruct:free", # Mistral
]

# Single model for the orchestration roles (question generation, category inference,
# analysis, entity verification). These are single-model jobs where vendor diversity
# buys nothing, so we use one reliable free model instead of burning panel quota.
ORCHESTRATOR_MODEL = "deepseek/deepseek-chat-v3.1:free"
QUESTION_MODEL = "deepseek/deepseek-chat-v3.1:free"


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
