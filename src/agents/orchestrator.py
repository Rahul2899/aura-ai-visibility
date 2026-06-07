import asyncio
import hashlib
import json
import os
import re
import structlog
from datetime import datetime

import boto3
import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Brand, Insight, ProbePerformance, ApiCall
from src.llm.client import OpenRouterClient, DEFAULT_MODELS
from src.llm.bedrock_client import BedrockClient, BEDROCK_MODELS
from src.llm.extractor import extract_mentions

log = structlog.get_logger()


async def _web_search_brand(name: str, domain: str | None, industry: str | None) -> str | None:
    """Enrich brand context via web search before probe generation.
    Uses Tavily if TAVILY_API_KEY is set; falls back to fetching the brand homepage.
    Returns a brief text summary, or None if no enrichment available."""
    tavily_key = os.environ.get("TAVILY_API_KEY")

    if tavily_key:
        try:
            query = f"{name} {industry or ''} software features pricing use cases".strip()
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.post(
                    "https://api.tavily.com/search",
                    json={
                        "api_key": tavily_key,
                        "query": query,
                        "search_depth": "basic",
                        "max_results": 4,
                        "include_answer": True,
                    }
                )
            if r.status_code == 200:
                data = r.json()
                answer = data.get("answer", "")
                snippets = " | ".join(
                    res.get("content", "")[:300]
                    for res in data.get("results", [])[:3]
                )
                summary = f"{answer} {snippets}".strip()[:1200]
                log.info("web_search_ok", brand=name, chars=len(summary))
                return summary
        except Exception as e:
            log.warning("web_search_failed", brand=name, error=str(e))

    # Fallback: scrape brand homepage if domain is known (SSRF-safe)
    if domain:
        safe_url = _safe_https_url(domain)
        if safe_url:
            try:
                async with httpx.AsyncClient(timeout=6, follow_redirects=False) as client:
                    r = await client.get(safe_url, headers={"User-Agent": "Mozilla/5.0 (compatible; AuraAI/1.0)"})
                if r.status_code == 200:
                    summary = extract_page_signal(r.text)
                    if summary:
                        log.info("homepage_fetch_ok", brand=name, chars=len(summary))
                        return summary
            except Exception as e:
                log.warning("homepage_fetch_failed", brand=name, domain=domain, error=str(e))
        else:
            log.warning("homepage_fetch_blocked_ssrf", brand=name, domain=domain)

    return None


def extract_page_signal(html: str) -> str:
    """Pull the high-signal parts of a homepage — title, meta description, and the
    first few headings — rather than raw tag-stripped text (which is mostly nav junk).
    This gives the orchestrator real product positioning to write specific probes."""
    def _first(pattern: str) -> str:
        m = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
        return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""

    title = _first(r"<title[^>]*>(.*?)</title>")
    meta_desc = _first(r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']')
    og_desc = _first(r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\'](.*?)["\']')

    headings = re.findall(r"<h[12][^>]*>(.*?)</h[12]>", html, re.IGNORECASE | re.DOTALL)
    headings = [re.sub(r"<[^>]+>", " ", h) for h in headings]
    headings = [re.sub(r"\s+", " ", h).strip() for h in headings]
    headings = [h for h in headings if 3 < len(h) < 120][:6]

    parts = []
    if title:
        parts.append(f"Title: {title}")
    if meta_desc or og_desc:
        parts.append(f"Description: {meta_desc or og_desc}")
    if headings:
        parts.append("Key messaging: " + " | ".join(headings))

    summary = "\n".join(parts).strip()
    if not summary:
        # Last resort: tag-stripped body, but skip the first chunk (usually nav/header).
        text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        summary = text[:1000]
    return summary[:1500]


def _safe_https_url(domain: str) -> str | None:
    """Return https://{domain} only if domain is a valid public hostname.
    Rejects: http(s):// prefixes, paths, ports, loopback, RFC1918, link-local,
    and cloud metadata addresses. Always builds the URL itself — never trusts
    user-supplied scheme."""
    import ipaddress
    import socket
    import re as _re

    # Must be a bare hostname: letters, digits, hyphens, dots — no scheme/path/port
    if not _re.fullmatch(r"[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*", domain):
        return None

    # Resolve and check all returned addresses
    try:
        results = socket.getaddrinfo(domain, 443, proto=socket.IPPROTO_TCP)
    except OSError:
        return None

    BLOCKED = [
        ipaddress.ip_network("127.0.0.0/8"),    # loopback
        ipaddress.ip_network("::1/128"),          # IPv6 loopback
        ipaddress.ip_network("10.0.0.0/8"),       # RFC1918
        ipaddress.ip_network("172.16.0.0/12"),    # RFC1918
        ipaddress.ip_network("192.168.0.0/16"),   # RFC1918
        ipaddress.ip_network("169.254.0.0/16"),   # link-local / AWS metadata
        ipaddress.ip_network("fe80::/10"),         # IPv6 link-local
        ipaddress.ip_network("0.0.0.0/8"),         # this-network
        ipaddress.ip_network("100.64.0.0/10"),    # shared address space
    ]

    for _family, _type, _proto, _canon, sockaddr in results:
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            return None
        for blocked_net in BLOCKED:
            try:
                if ip in blocked_net:
                    return None
            except TypeError:
                pass  # ipv4 vs ipv6 mismatch — skip

    return f"https://{domain}"

ORCHESTRATOR_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
MAX_STEPS = 30
MODEL_CONFIGS = [(m, "openrouter") for m in DEFAULT_MODELS] + [(m, "bedrock") for m in BEDROCK_MODELS]

# Friendly names for the live activity feed. .get fallback means a model swap can't crash the feed.
MODEL_DISPLAY = {
    "us.amazon.nova-pro-v1:0": "Nova Pro",
    "us.meta.llama3-3-70b-instruct-v1:0": "Llama 3.3",
    "us.anthropic.claude-haiku-4-5-20251001-v1:0": "Claude Haiku",
    "mistral.mistral-large-2402-v1:0": "Mistral Large",
}


def friendly(model: str) -> str:
    return MODEL_DISPLAY.get(model, model.split(".")[-1].split("-")[0].title())


def compute_visibility(model_hits: dict[str, list[bool]]) -> float | None:
    """Overall visibility % = total brand mentions across every (probe × model)
    result divided by the total number of results. Returns None if no results
    (so an audit with zero successful probes is 'unknown', not 0%)."""
    total = sum(len(hits) for hits in model_hits.values())
    if total == 0:
        return None
    hits = sum(sum(h) for h in model_hits.values())
    return round(hits / total * 100, 1)

SYSTEM_PROMPT = """You are an AI brand visibility analyst. Your job is to measure how visible a brand is in AI responses, and report what you measured. You do NOT give marketing advice or recommend actions.

Follow these steps IN ORDER:

1. Call get_brand_context. It returns name, domain, industry, competitors, and usually web_context (live search snippets about the brand).

2. UNDERSTAND THE BRAND FIRST. Before writing any question, read web_context carefully and form a clear picture of what this brand actually is: what category it competes in, what it sells, who buys it, its price tier, and its real competitors. If web_context is thin or missing, infer carefully from the name and domain and stay conservative. Do not proceed to questions until you understand the brand.

3. Write 8-10 probe questions a REAL BUYER would type into an AI assistant when shopping in this category. Every question must flow from your understanding in step 2. Do NOT ask generic "Tell me about brand X" queries.

REALITY RULES — questions MUST make factual sense for THIS brand:
- Never invent prices, specs, or numbers. Only use figures that appear in web_context. If you don't know the price, don't ask a price-bracketed question.
- Match the brand's actual category and tier. A premium electric vehicle is not "under $10,000"; an enterprise HR suite is not "free for individuals". Absurd or contradictory premises are forbidden.
- If a question would be implausible for someone actually shopping in this category, rewrite it.
- Use only real competitor names (from the context or web_context), not invented ones.

Question types to draw from:
   - Brand-Direct: specific technical, pricing, integration, or compliance details (e.g., "Does [Brand] support HIPAA compliance?").
   - Category Recommendation: natural recommendation queries with scale, industry, and pain point (e.g., "Best expense management software for a 50-person B2B SaaS startup?").
   - Feature-Specific: solutions with specific capabilities (e.g., "Which virtual card systems allow instant CSV exports?").
   - Competitor Face-Off: side-by-side comparisons against real competitors (e.g., "Compare [Brand] vs [Competitor] on ease-of-use and API coverage").
   - Regional/Market: queries relevant to the brand's main customer markets.

4. Call finish with the measurement.

WRITE TIGHT. No filler, no hedging, no marketing speak. Describe what you measured, not what the brand should do.

Rules for finish():
- summary: ONE sentence, max 18 words. State the visibility % and the single biggest pattern observed.
- key_findings: exactly 3-4 bullets. Each MAX 14 WORDS and MUST start with a number or %. These are FACTUAL OBSERVATIONS about the measurement only (strongest query type, weakest query type, biggest model gap). Do NOT suggest actions.

Findings describe what was measured, never what to do. This tool reports AI visibility; it does not advise.

GOOD finding: "0% on feature queries like 'best onboarding software'"
GOOD finding: "88% on competitor comparisons, strongest category"
BAD (advice, not a finding): "Publish G2 reviews to improve visibility"
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
                    "key_findings": {"type": "array", "items": {"type": "string"}, "description": "3-5 factual observations about the measurement, each starting with a metric. No advice."},
                    "probe_count": {"type": "integer"},
                    "visibility_pct": {"type": "number"},
                },
                "required": ["summary", "key_findings", "probe_count", "visibility_pct"],
            }},
        }
    },
]


def _bedrock_client():
    # On EC2 with IAM role: no explicit keys needed — boto3 uses instance metadata.
    kwargs = {"region_name": os.environ.get("AWS_REGION", "us-east-1")}
    if os.environ.get("AWS_ACCESS_KEY_ID"):
        kwargs["aws_access_key_id"] = os.environ.get("AWS_ACCESS_KEY_ID")
        kwargs["aws_secret_access_key"] = os.environ.get("AWS_SECRET_ACCESS_KEY")
    return boto3.client("bedrock-runtime", **kwargs)


def _call_claude_sync(client, messages: list) -> dict:
    return client.converse(
        modelId=ORCHESTRATOR_MODEL,
        system=[{"text": SYSTEM_PROMPT}],
        messages=messages,
        toolConfig={"tools": TOOLS},
        inferenceConfig={"maxTokens": 4096, "temperature": 0.3},
    )


async def _probe_one_model(provider: str, model: str, prompt_text: str, target_brand: str, on_event=None) -> dict:
    """Run one model. Returns a dict with `failed` flag so failed calls are excluded from the
    score instead of being counted as a real non-mention (which would corrupt visibility %).
    Uses the structured extractor — not a naive string match — to prevent hallucination false positives."""
    client = BedrockClient() if provider == "bedrock" else OpenRouterClient()
    try:
        result = await client.complete(model=model, messages=[{"role": "user", "content": prompt_text}])
        extraction = await extract_mentions(client, model, result["text"])
        mentioned = any(target_brand.lower() in m.brand_name.lower() for m in extraction.mentions)
        if on_event:
            on_event(f"{friendly(model)}: {'✓ mentioned' if mentioned else '✗ not found'}")
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


async def _run_probe_tool(session: AsyncSession, brand_id: int, prompt_text: str, target_brand: str, on_event=None) -> dict:
    """Run one probe across all models. Updates ProbePerformance. Returns summary dict."""
    semaphore = asyncio.Semaphore(10)

    async def bounded(p, m):
        async with semaphore:
            return await _probe_one_model(p, m, prompt_text, target_brand, on_event=on_event)

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

    # Atomic upsert keyed on the unique (brand_id, prompt_hash) constraint. Using
    # ON CONFLICT avoids a SELECT-then-INSERT race when two audits of the same brand
    # run concurrently (they would otherwise create duplicate rows that split run_count).
    h = hashlib.sha256(prompt_text.encode()).hexdigest()
    stmt = pg_insert(ProbePerformance).values(
        brand_id=brand_id, prompt_hash=h, prompt_text=prompt_text,
        run_count=1, hit_count=int(hit), last_used=datetime.utcnow(),
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_probe_brand_hash",
        set_={
            "run_count": ProbePerformance.run_count + 1,
            "hit_count": ProbePerformance.hit_count + int(hit),
            "last_used": datetime.utcnow(),
        },
    )
    await session.execute(stmt)
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
    context = {
        "name": brand.name,
        "domain": brand.domain,
        "industry": brand.industry or "unknown",
        "competitors": brand.competitors or [],
    }
    # Enrich with live web data so probes reference real features/positioning
    web_summary = await _web_search_brand(brand.name, brand.domain, brand.industry)
    if web_summary:
        context["web_context"] = web_summary
    return context


async def orchestrate(session: AsyncSession, brand_id: int, dry_run: bool = False, custom_questions: list[str] | None = None, on_event=None) -> Insight | None:
    """Run the Hermes orchestration loop for a brand. Returns saved Insight or None on dry_run."""
    def emit(msg: str):
        if on_event:
            try:
                on_event(msg)
            except Exception:
                pass

    bedrock = _bedrock_client()
    custom_block = ""
    if custom_questions:
        formatted = "\n".join(f"- {q}" for q in custom_questions if q.strip())
        custom_block = f"\n\nThe user also wants these specific questions tested (run them FIRST before generating your own):\n{formatted}"
    messages = [{"role": "user", "content": [{"text": f"Audit brand_id={brand_id}. Start with get_brand_context.{custom_block}"}]}]
    tool_calls_log = []
    probe_count = 0
    model_hits: dict[str, list[bool]] = {}  # {model: [mentioned_per_probe]}

    log.info("orchestrate_start", brand_id=brand_id, dry_run=dry_run)
    emit("Starting audit…")

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
                emit("Searching the web for brand context…")
                result = await _get_brand_context_tool(session, tool_input["brand_id"])
                emit("Gathered brand context. Generating questions…")

            elif tool_name == "run_probe":
                if dry_run:
                    result = {"dry_run": True, "prompt": tool_input["prompt_text"]}
                    log.info("dry_run_probe", prompt=tool_input["prompt_text"])
                else:
                    emit(f"Asking {len(MODEL_CONFIGS)} models: \"{tool_input['prompt_text'][:60]}…\"")
                    result = await _run_probe_tool(session, brand_id, tool_input["prompt_text"], tool_input["target_brand_name"], on_event=emit)
                    probe_count += 1
                    for model, mentioned in result.get("breakdown", {}).items():
                        model_hits.setdefault(model, []).append(mentioned == "yes")
                    emit(f"Probe {probe_count}: {result['visibility_pct']}% visible")
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
            # Compute visibility from actual probe results, NOT from Haiku's self-reported
            # number — the model can miscalculate. Overall visibility = total hits across
            # every (probe × model) result divided by total results.
            visibility_pct = compute_visibility(model_hits)
            emit(f"Scoring visibility… {visibility_pct}%")
            insight = Insight(
                brand_id=brand_id,
                summary=insight_data["summary"],
                key_findings=insight_data.get("key_findings", []),
                recommendations=[],  # Aura measures visibility; it does not advise. Column kept to avoid a migration.
                probe_count=probe_count,
                visibility_pct=visibility_pct,
                model_breakdown=model_breakdown,
                raw_tool_calls=tool_calls_log,
            )
            session.add(insight)
            await session.commit()
            log.info("orchestrate_done", brand_id=brand_id, probe_count=probe_count,
                     visibility_pct=visibility_pct)
            return insight

        if response["stopReason"] == "end_turn":
            break

    log.error("orchestrate_max_steps", brand_id=brand_id, steps=MAX_STEPS)
    return None
