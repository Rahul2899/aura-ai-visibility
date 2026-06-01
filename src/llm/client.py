import asyncio
import os
import time
import httpx
import structlog
from dotenv import load_dotenv

load_dotenv()
log = structlog.get_logger()

OPENROUTER_BASE = "https://openrouter.ai/api/v1"

# Production uses Bedrock only. To re-enable OpenRouter:
#   1. Add model IDs to DEFAULT_MODELS below (e.g. "meta-llama/llama-3.3-70b-instruct")
#   2. Set OPENROUTER_API_KEY in your .env
DEFAULT_MODELS: list[str] = []


class OpenRouterClient:
    def __init__(self):
        key = os.environ.get("OPENROUTER_API_KEY")
        if not key:
            raise RuntimeError("OPENROUTER_API_KEY is not set. Add it to .env or set DEFAULT_MODELS=[] to use Bedrock only.")
        self.api_key = key
        self.http = httpx.AsyncClient(timeout=90)

    async def complete(self, model: str, messages: list[dict], max_retries: int = 3) -> dict:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "HTTP-Referer": "https://github.com/peec-clone",
        }
        payload = {"model": model, "messages": messages}

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
