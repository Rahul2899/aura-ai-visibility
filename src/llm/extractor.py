import json
from pathlib import Path
from typing import Literal
import structlog
from pydantic import BaseModel, ValidationError

log = structlog.get_logger()

EXTRACTION_PROMPT = (Path(__file__).parent.parent.parent / "prompts" / "extraction.txt").read_text()


class BrandMention(BaseModel):
    brand_name: str
    position: int
    sentiment: Literal["positive", "neutral", "negative"]
    cited_urls: list[str] = []


class ExtractionResult(BaseModel):
    mentions: list[BrandMention]


async def extract_mentions(
    client,  # OpenRouterClient or BedrockClient
    model: str,
    response_text: str,
    max_retries: int = 2,  # 1 initial + 1 retry; failure falls back to empty (model excluded from score)
) -> ExtractionResult:
    messages = [
        {"role": "system", "content": EXTRACTION_PROMPT},
        {"role": "user", "content": f"Extract all brand mentions from this text:\n\n{response_text}"},
    ]

    last_error: str = ""
    last_raw: str = ""  # last raw model output, fed back on retry for self-correction
    for attempt in range(max_retries):
        if attempt > 0 and last_error:
            # Feed the validation error back so the model self-corrects
            messages.append({"role": "assistant", "content": last_raw})
            messages.append({
                "role": "user",
                "content": f"Your response failed JSON validation: {last_error}\n\nPlease return ONLY valid JSON matching the schema.",
            })

        result = await client.complete(model=model, messages=messages)
        raw = result["text"].strip()
        last_raw = raw

        # Strip markdown fences if model wraps output anyway
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        try:
            data = json.loads(raw)
            parsed = ExtractionResult.model_validate(data)
            if attempt > 0:
                log.info("extractor_recovered", attempt=attempt)
            return parsed
        except (json.JSONDecodeError, ValidationError) as e:
            last_error = str(e)
            log.warning("extractor_retry", attempt=attempt, error=last_error[:200])

    log.error("extractor_failed", attempts=max_retries)
    return ExtractionResult(mentions=[])
