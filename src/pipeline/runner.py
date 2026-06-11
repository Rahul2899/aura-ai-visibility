import asyncio
import hashlib
from datetime import date

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Brand, Prompt, Run, Mention, ApiCall
from src.llm.client import OpenRouterClient, DEFAULT_MODELS
from src.llm.bedrock_client import BedrockClient, BEDROCK_MODELS
from src.llm.extractor import extract_mentions

log = structlog.get_logger()

SEMAPHORE_LIMIT = 10


def _content_hash(prompt_text: str, model: str, run_date: str) -> str:
    key = f"{prompt_text}|{model}|{run_date}"
    return hashlib.sha256(key.encode()).hexdigest()


def _get_client(provider: str):
    if provider == "bedrock":
        return BedrockClient()
    return OpenRouterClient()


async def _run_single(
    session: AsyncSession,
    prompt: Prompt,
    model: str,
    provider: str,
    target_brand_name: str,
    semaphore: asyncio.Semaphore,
) -> None:
    today = date.today().isoformat()
    chash = _content_hash(prompt.text, model, today)

    existing = await session.scalar(select(Run).where(Run.content_hash == chash))
    if existing:
        log.debug("skipped_cached", model=model, prompt_id=prompt.id)
        return

    async with semaphore:
        client = _get_client(provider)
        try:
            result = await client.complete(model=model, messages=[{"role": "user", "content": prompt.text}])
        except Exception as e:
            log.error("llm_error", model=model, prompt_id=prompt.id, error=str(e))
            return
        finally:
            if hasattr(client, "close"):
                await client.close()

    run = Run(
        prompt_id=prompt.id,
        model=model,
        provider=provider,
        response_text=result["text"],
        latency_ms=result["latency_ms"],
        tokens_in=result.get("tokens_in") or 0,
        tokens_out=result.get("tokens_out") or 0,
        content_hash=chash,
    )
    session.add(run)

    api_log = ApiCall(
        model=model,
        provider=provider,
        latency_ms=result["latency_ms"],
        tokens_in=result.get("tokens_in") or 0,
        tokens_out=result.get("tokens_out") or 0,
    )
    session.add(api_log)
    await session.flush()

    # Extract mentions using the same provider/model for consistency
    extractor_client = _get_client(provider)
    try:
        extraction = await extract_mentions(extractor_client, model, result["text"])
    finally:
        if hasattr(extractor_client, "close"):
            await extractor_client.close()

    for m in extraction.mentions:
        mention = Mention(
            run_id=run.id,
            brand_name=m.brand_name,
            position=m.position,
            sentiment=m.sentiment,
            is_target_brand=target_brand_name.lower() in m.brand_name.lower(),
            cited_urls=m.cited_urls,
        )
        session.add(mention)

    await session.commit()
    log.info(
        "run_complete",
        prompt_id=prompt.id,
        model=model,
        mentions=len(extraction.mentions),
        target_found=any(m.is_target_brand for m in extraction.mentions),
    )


async def run_audit(session: AsyncSession, brand_id: int) -> None:
    brand = await session.get(Brand, brand_id)
    if not brand:
        raise ValueError(f"Brand {brand_id} not found")

    prompts = (await session.scalars(select(Prompt).where(Prompt.brand_id == brand_id))).all()
    if not prompts:
        raise ValueError(f"No prompts found for brand {brand_id}")

    model_configs = (
        [(m, "openrouter") for m in DEFAULT_MODELS]
        + [(m, "bedrock") for m in BEDROCK_MODELS]
    )

    semaphore = asyncio.Semaphore(SEMAPHORE_LIMIT)
    tasks = [
        _run_single(session, prompt, model, provider, brand.name, semaphore)
        for prompt in prompts
        for model, provider in model_configs
    ]

    log.info("audit_start", brand=brand.name, prompts=len(prompts), model_configs=len(model_configs), total_calls=len(tasks))
    await asyncio.gather(*tasks)
    log.info("audit_done", brand=brand.name, total_calls=len(tasks))
