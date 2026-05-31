import asyncio
import hashlib
import json
import os
import time
import structlog
from datetime import datetime

import boto3
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Brand, Insight, ProbePerformance, ApiCall
from src.llm.client import OpenRouterClient, DEFAULT_MODELS
from src.llm.bedrock_client import BedrockClient, BEDROCK_MODELS
from src.llm.extractor import extract_mentions

log = structlog.get_logger()

ORCHESTRATOR_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
MAX_STEPS = 30
MODEL_CONFIGS = [(m, "openrouter") for m in DEFAULT_MODELS] + [(m, "bedrock") for m in BEDROCK_MODELS]

SYSTEM_PROMPT = """You are an AI brand visibility analyst. AI models learn from web content — your job is to measure how visible a brand is in AI responses AND tell the marketing team how to improve it.

Steps:
1. Call get_brand_context.
2. Run 8-10 probe questions covering: brand-direct, category, feature, regional, and competitor-comparison queries.
3. Call finish with structured findings.

WRITE TIGHT. No filler, no hedging, no marketing speak. Every output is scannable in 2 seconds.

Rules for finish():
- summary: ONE sentence, max 18 words. State the visibility % and the single biggest pattern.
- key_findings: exactly 3-4 bullets. Each MAX 14 WORDS and MUST start with a number or %. Cover: strongest query type, weakest query type, biggest model gap.
- recommendations: 2-3 actions. Each MAX 16 WORDS. Name the channel (G2, Wikipedia, Reddit, Gartner) and the expected effect.

AI visibility levers (ground recommendations in these):
- G2/Capterra reviews — heavily indexed by AI training crawlers.
- Wikipedia — the fact-check layer; gaps = invisibility in factual queries.
- "Brand vs Competitor" pages — over-scraped by training crawlers.
- Press (TechCrunch, Forbes, Gartner) — high-authority training signal.
- Reddit/Quora — community forums are over-represented in training data.
- Brand name consistency — name variations split the signal across entities.

GOOD finding: "0% on feature queries like 'best onboarding software' — category gap"
GOOD recommendation: "Publish 30+ G2 reviews naming key features — moves feature-query visibility"
BAD (too long): "The brand achieves strong visibility on direct queries but shows concerning gaps when..."
"""

TOOLS = [
    {
        "toolSpec": {
            "name": "get_brand_context",
            "description": "Fetch brand name, domain, and competitors from the database.",
            "inputSchema": {"json": {
                "type": "object",
                "properties": {"brand_id": {"type": "integer"}},
                "required": ["brand_id"],
            }},
        }
    },
    {
        "toolSpec": {
            "name": "run_probe",
            "description": "Run one probe question across every AI model. Returns per-model mention results.",
            "inputSchema": {"json": {
                "type": "object",
                "properties": {
                    "prompt_text": {"type": "string"},
                    "target_brand_name": {"type": "string"},
                },
                "required": ["prompt_text", "target_brand_name"],
            }},
        }
    },
    {
        "toolSpec": {
            "name": "finish",
            "description": "Save the structured audit findings and end the session.",
            "inputSchema": {"json": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string", "description": "One sentence with overall visibility % and key pattern"},
                    "key_findings": {"type": "array", "items": {"type": "string"}, "description": "3-5 specific findings each starting with a metric"},
                    "recommendations": {"type": "array", "items": {"type": "string"}, "description": "2-3 specific actions a marketing team can take"},
                    "probe_count": {"type": "integer"},
                    "visibility_pct": {"type": "number"},
                },
                "required": ["summary", "key_findings", "recommendations", "probe_count", "visibility_pct"],
            }},
        }
    },
]


def _bedrock_client():
    return boto3.client(
        "bedrock-runtime",
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
    )


def _call_claude_sync(client, messages: list) -> dict:
    return client.converse(
        modelId=ORCHESTRATOR_MODEL,
        system=[{"text": SYSTEM_PROMPT}],
        messages=messages,
        toolConfig={"tools": TOOLS},
        inferenceConfig={"maxTokens": 4096, "temperature": 0.3},
    )


async def _probe_one_model(provider: str, model: str, prompt_text: str, target_brand: str) -> dict:
    """Run one model. Returns a dict with `failed` flag so failed calls are excluded from the
    score instead of being counted as a real non-mention (which would corrupt visibility %).
    Uses the structured extractor — not a naive string match — to prevent hallucination false positives."""
    client = BedrockClient() if provider == "bedrock" else OpenRouterClient()
    try:
        result = await client.complete(model=model, messages=[{"role": "user", "content": prompt_text}])
        extraction = await extract_mentions(client, model, result["text"])
        mentioned = any(target_brand.lower() in m.brand_name.lower() for m in extraction.mentions)
        return {
            "model": model, "provider": provider, "mentioned": mentioned, "failed": False,
            "tokens_in": result.get("tokens_in", 0), "tokens_out": result.get("tokens_out", 0),
            "latency_ms": result["latency_ms"],
        }
    except Exception as e:
        log.warning("probe_model_error", model=model, error=str(e))
        return {"model": model, "provider": provider, "mentioned": False, "failed": True,
                "tokens_in": 0, "tokens_out": 0, "latency_ms": 0}
    finally:
        if hasattr(client, "close"):
            await client.close()


async def _run_probe_tool(session: AsyncSession, brand_id: int, prompt_text: str, target_brand: str) -> dict:
    """Run one probe across all models. Updates ProbePerformance. Returns summary dict."""
    semaphore = asyncio.Semaphore(10)

    async def bounded(p, m):
        async with semaphore:
            return await _probe_one_model(p, m, prompt_text, target_brand)

    results = await asyncio.gather(*[bounded(p, m) for m, p in MODEL_CONFIGS])

    # Only models that actually responded count toward the score. Failed calls are excluded
    # from the denominator — a model that errored is "unknown", not a "no".
    model_breakdown = {}
    total_cost = 0.0
    for r in results:
        cost = (r["tokens_in"] * 0.00025 + r["tokens_out"] * 0.00125) / 1000 if r["provider"] == "bedrock" else 0.0
        total_cost += cost
        session.add(ApiCall(model=r["model"], provider=r["provider"], latency_ms=r["latency_ms"],
                            tokens_in=r["tokens_in"], tokens_out=r["tokens_out"], cost_usd=cost))
        if not r["failed"]:
            model_breakdown[r["model"]] = r["mentioned"]

    succeeded = len(model_breakdown)
    hit_count = sum(1 for v in model_breakdown.values() if v)
    hit = hit_count > 0

    # Update probe performance (no LLM — pure arithmetic)
    h = hashlib.sha256(prompt_text.encode()).hexdigest()
    perf = await session.scalar(
        select(ProbePerformance).where(ProbePerformance.brand_id == brand_id, ProbePerformance.prompt_hash == h)
    )
    if perf:
        perf.run_count += 1
        perf.hit_count += int(hit)
        perf.last_used = datetime.utcnow()
    else:
        session.add(ProbePerformance(
            brand_id=brand_id, prompt_hash=h, prompt_text=prompt_text,
            run_count=1, hit_count=int(hit),
        ))

    await session.flush()

    return {
        "prompt": prompt_text,
        "models_mentioned": hit_count,
        "models_checked": succeeded,
        "visibility_pct": round(hit_count / succeeded * 100, 1) if succeeded else 0.0,
        "breakdown": {m: "yes" if v else "no" for m, v in model_breakdown.items()},
    }


async def _get_brand_context_tool(session: AsyncSession, brand_id: int) -> dict:
    brand = await session.get(Brand, brand_id)
    if not brand:
        raise ValueError(f"Brand {brand_id} not found")
    return {"name": brand.name, "domain": brand.domain, "competitors": brand.competitors or []}


async def orchestrate(session: AsyncSession, brand_id: int, dry_run: bool = False) -> Insight | None:
    """Run the Hermes orchestration loop for a brand. Returns saved Insight or None on dry_run."""
    bedrock = _bedrock_client()
    messages = [{"role": "user", "content": [{"text": f"Audit brand_id={brand_id}. Start with get_brand_context."}]}]
    tool_calls_log = []
    probe_count = 0
    model_hits: dict[str, list[bool]] = {}  # {model: [mentioned_per_probe]}

    log.info("orchestrate_start", brand_id=brand_id, dry_run=dry_run)

    for step in range(MAX_STEPS):
        response = await asyncio.to_thread(_call_claude_sync, bedrock, messages)
        msg = response["output"]["message"]
        messages.append(msg)

        tool_results = []
        finished = False
        insight_data = {}

        for block in msg["content"]:
            if "toolUse" not in block:
                continue

            tool_name = block["toolUse"]["name"]
            tool_input = block["toolUse"]["input"]
            tool_use_id = block["toolUse"]["toolUseId"]
            tool_calls_log.append({"tool": tool_name, "input": tool_input})

            if tool_name == "get_brand_context":
                result = await _get_brand_context_tool(session, tool_input["brand_id"])

            elif tool_name == "run_probe":
                if dry_run:
                    result = {"dry_run": True, "prompt": tool_input["prompt_text"]}
                    log.info("dry_run_probe", prompt=tool_input["prompt_text"])
                else:
                    result = await _run_probe_tool(session, brand_id, tool_input["prompt_text"], tool_input["target_brand_name"])
                    probe_count += 1
                    for model, mentioned in result.get("breakdown", {}).items():
                        model_hits.setdefault(model, []).append(mentioned == "yes")
                    log.info("probe_done", probe_count=probe_count, visibility_pct=result["visibility_pct"])

            elif tool_name == "finish":
                insight_data = tool_input
                finished = True
                result = {"status": "saved"}

            else:
                result = {"error": f"unknown tool: {tool_name}"}

            tool_results.append({
                "toolResult": {"toolUseId": tool_use_id, "content": [{"text": json.dumps(result)}]}
            })

        if tool_results:
            messages.append({"role": "user", "content": tool_results})

        if finished:
            if dry_run:
                log.info("dry_run_complete", steps=step + 1)
                return None

            model_breakdown = {
                m: round(sum(hits) / len(hits) * 100, 1)
                for m, hits in model_hits.items() if hits
            }
            insight = Insight(
                brand_id=brand_id,
                summary=insight_data["summary"],
                key_findings=insight_data.get("key_findings", []),
                recommendations=insight_data.get("recommendations", []),
                probe_count=probe_count,
                visibility_pct=insight_data.get("visibility_pct"),
                model_breakdown=model_breakdown,
                raw_tool_calls=tool_calls_log,
            )
            session.add(insight)
            await session.commit()
            log.info("orchestrate_done", brand_id=brand_id, probe_count=probe_count,
                     visibility_pct=insight_data.get("visibility_pct"))
            return insight

        if response["stopReason"] == "end_turn":
            break

    log.error("orchestrate_max_steps", brand_id=brand_id, steps=MAX_STEPS)
    return None
