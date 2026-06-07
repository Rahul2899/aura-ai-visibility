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


async def _scrape_homepage(name: str, domain: str) -> str | None:
    """Fetch the brand's own homepage (SSRF-safe). This is the ONE source that is
    unambiguously the right company — no entity-confusion risk."""
    safe_url = _safe_https_url(domain)
    if not safe_url:
        log.warning("homepage_fetch_blocked_ssrf", brand=name, domain=domain)
        return None
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
    return None


async def _tavily_search(name: str, domain: str | None, industry: str | None) -> str | None:
    tavily_key = os.environ.get("TAVILY_API_KEY")
    if not tavily_key:
        return None
    # Anchor the query to the specific entity: prefer the domain (kills name
    # collisions), then name+industry. Obscure brands sharing a name with a bigger
    # company is exactly why the domain matters most.
    anchor = domain or f"{name} {industry or ''}"
    query = f"{name} {anchor} company products features pricing".strip()
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.post(
                "https://api.tavily.com/search",
                json={"api_key": tavily_key, "query": query, "search_depth": "basic",
                      "max_results": 4, "include_answer": True},
            )
        if r.status_code == 200:
            data = r.json()
            answer = data.get("answer", "")
            snippets = " | ".join(res.get("content", "")[:300] for res in data.get("results", [])[:3])
            summary = f"{answer} {snippets}".strip()[:1200]
            log.info("web_search_ok", brand=name, chars=len(summary))
            return summary
    except Exception as e:
        log.warning("web_search_failed", brand=name, error=str(e))
    return None


async def _web_search_brand(name: str, domain: str | None, industry: str | None) -> tuple[str | None, str]:
    """Gather brand context. Returns (summary, source) where source is:
      "homepage" — scraped the brand's own domain: unambiguously the right company
      "search"   — name-based web search: MAY be a different same-named entity, verify
      "none"     — nothing found.
    Domain-first: when a domain is given, the homepage is authoritative, so we use it
    and skip the ambiguity-prone name search entirely."""
    if domain:
        homepage = await _scrape_homepage(name, domain)
        if homepage:
            return homepage, "homepage"
    summary = await _tavily_search(name, domain, industry)
    if summary:
        return summary, "search"
    return None, "none"


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

    # Normalize real-world input to a bare host: users paste full URLs
    # ("https://perulatus.com/en/homepage-en/"), with www, ports, or paths.
    # Strip all of that down to the hostname, THEN apply the strict SSRF check.
    domain = (domain or "").strip()
    domain = _re.sub(r"^[a-zA-Z][a-zA-Z0-9+.\-]*://", "", domain)  # scheme
    domain = domain.split("/")[0].split("?")[0].split("#")[0]      # path/query/fragment
    domain = domain.split("@")[-1]                                  # userinfo
    domain = domain.split(":")[0]                                   # port
    domain = domain.rstrip(".").lower()
    if domain.startswith("www."):
        domain = domain[4:]

    # Must now be a bare hostname: letters, digits, hyphens, dots — no scheme/path/port
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

# Two-phase: a stronger model writes the probe questions (where human-buyer framing
# matters most — one call, so the cost is contained), a fast/cheap model does the
# analysis/summary in phase B.
QUESTION_MODEL = "eu.anthropic.claude-sonnet-4-6"
ORCHESTRATOR_MODEL = "eu.anthropic.claude-haiku-4-5-20251001-v1:0"  # phase B (analysis)
MODEL_CONFIGS = [(m, "openrouter") for m in DEFAULT_MODELS] + [(m, "bedrock") for m in BEDROCK_MODELS]

# Friendly names for the live activity feed. .get fallback means a model swap can't crash the feed.
MODEL_DISPLAY = {
    "eu.anthropic.claude-sonnet-4-6": "Claude Sonnet 4.6",
    "eu.amazon.nova-pro-v1:0": "Nova Pro",
    "qwen.qwen3-32b-v1:0": "Qwen3 32B",
    "nvidia.nemotron-super-3-120b": "NVIDIA Nemotron",
    # orchestrator/analysis model (still Haiku) — kept here for friendly logs
    "eu.anthropic.claude-haiku-4-5-20251001-v1:0": "Claude Haiku 4.5",
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



def _bedrock_client():
    # On EC2 with IAM role: no explicit keys needed — boto3 uses instance metadata.
    kwargs = {"region_name": os.environ.get("AWS_REGION", "us-east-1")}
    if os.environ.get("AWS_ACCESS_KEY_ID"):
        kwargs["aws_access_key_id"] = os.environ.get("AWS_ACCESS_KEY_ID")
        kwargs["aws_secret_access_key"] = os.environ.get("AWS_SECRET_ACCESS_KEY")
    return boto3.client("bedrock-runtime", **kwargs)


def _brand_matches(target: str, extracted: str) -> bool:
    """Whole-word match of the target brand against an extracted brand name, so e.g.
    "Lever" matches "Lever" / "Lever ATS" but NOT "Cleverbit" or "leverage" (a naive
    substring check would false-positive on those)."""
    t, e = target.strip().lower(), extracted.strip().lower()
    if not t:
        return False
    if t == e:
        return True
    # target appears as a complete word/token within the extracted name
    return re.search(rf"(?<![a-z0-9]){re.escape(t)}(?![a-z0-9])", e) is not None


async def _probe_one_model(provider: str, model: str, prompt_text: str, target_brand: str, on_event=None) -> dict:
    """Run one model. Returns a dict with `failed` flag so failed calls are excluded from the
    score instead of being counted as a real non-mention (which would corrupt visibility %).
    Uses the structured extractor — not a naive string match — to prevent hallucination false positives."""
    client = BedrockClient() if provider == "bedrock" else OpenRouterClient()
    try:
        result = await client.complete(model=model, messages=[{"role": "user", "content": prompt_text}])
        extraction = await extract_mentions(client, model, result["text"])
        mentioned = any(_brand_matches(target_brand, m.brand_name) for m in extraction.mentions)
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
    # Enrich with live web data so probes reference real features/positioning.
    # `source` tells the caller whether this is the brand's own homepage (trusted)
    # or a name-based search (may be a different same-named entity — needs verifying).
    web_summary, source = await _web_search_brand(brand.name, brand.domain, brand.industry)
    if web_summary:
        context["web_context"] = web_summary
    context["_source"] = source
    return context


QUESTION_GEN_PROMPT = """You write the questions a REAL BUYER would type into an AI assistant (ChatGPT, Claude, Gemini) when researching what to buy in a category. Given a brand's context, output 8-10 such questions.

You will receive the brand's name, industry, competitors, and web_context (live search results). UNDERSTAND the brand first: what category it competes in, what it sells, who buys it, its price tier, its real competitors. Then write questions that flow from that understanding.

REALITY RULES — every question must make factual sense for THIS brand:
- Never invent prices, specs, or numbers. Only use figures from web_context.
- Match the brand's real category and tier (a premium EV is not "under $10,000").
- Write how a real person actually types to an AI: natural, with real context and scenario ("a 20-person startup that needs docs and project tracking"), not terse keyword queries.
- Keep each question to ONE sentence, under 25 words. Plain punctuation only: use commas and periods, never em-dashes or en-dashes.
- Use only real competitor names (from context/web_context).

MOST questions (at least 7 of 10) must be CATEGORY questions that do NOT name this
brand — they describe a need and ask what to use ("best AI meeting notetaker for a
remote team of 10", "which expense tool works for a 50-person B2B SaaS startup").
These test whether the brand surfaces on its own, which is the real measure.
The remaining 2-3 may name the brand directly (pricing, integrations, compliance,
or a head-to-head vs a named competitor). Do not exceed 3 that name the brand.

Return ONLY a JSON object: {"questions": ["...", "..."]}. No prose, no markdown fences."""


async def _generate_questions(bedrock, context: dict, custom_questions: list[str] | None) -> list[str]:
    """Phase A: one call to the stronger QUESTION_MODEL to write all probe questions,
    grounded in the brand's real web context. Custom questions (if any) run first."""
    user = f"Brand context:\n{json.dumps(context, indent=2)}\n\nWrite 8-10 buyer questions as JSON."
    resp = await asyncio.to_thread(
        lambda: bedrock.converse(
            modelId=QUESTION_MODEL,
            system=[{"text": QUESTION_GEN_PROMPT}],
            messages=[{"role": "user", "content": [{"text": user}]}],
            # Conversational questions are long; generous budget so the JSON array
            # isn't truncated mid-element (which forces the salvage path below).
            inferenceConfig={"maxTokens": 2600, "temperature": 0.7},
        )
    )
    raw = resp["output"]["message"]["content"][0]["text"].strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1].removeprefix("json").strip()
    try:
        generated = json.loads(raw).get("questions", [])
    except (json.JSONDecodeError, KeyError, IndexError):
        # Salvage a truncated array: keep up to the last COMPLETE element (a closing
        # quote followed by a comma), then close the JSON and let json.loads decode it
        # PROPERLY — handles \uXXXX and UTF-8 right, where a manual unicode_escape would
        # mangle em-dashes into mojibake (the bug this replaces).
        generated = []
        cut = raw.rfind('",')           # end of the last fully-written element
        if cut > 0:
            repaired = raw[:cut + 1] + "]}"   # raw[:cut+1] ends at the closing quote
            try:
                generated = json.loads(repaired).get("questions", [])
            except (json.JSONDecodeError, KeyError):
                generated = []
        log.warning("question_gen_salvaged", recovered=len(generated), raw=raw[:120])
    custom = [q.strip() for q in (custom_questions or []) if q.strip()]
    # Custom questions first, then generated; cap to keep audits bounded.
    return (custom + [q for q in generated if isinstance(q, str) and q.strip()])[:12]


ANALYSIS_PROMPT = """You are an AI brand visibility analyst. You receive a brand name and per-probe results (each question, and which AI models mentioned the brand). Report what was measured. You do NOT give marketing advice.

Return ONLY JSON: {"summary": "...", "key_findings": ["...", "..."]}.
- summary: ONE sentence, max 18 words, stating the overall visibility % and the single biggest pattern.
- key_findings: 3-4 factual observations, each starting with a number or %, max 14 words. Cover strongest query type, weakest query type, biggest model gap. NO advice — describe what was measured, never what to do.
No prose, no markdown fences."""


async def _generate_analysis(bedrock, brand_name: str, visibility_pct: float, probe_results: list[dict]) -> dict:
    """Phase B analysis: one fast Haiku call to write the summary + factual findings."""
    payload = {"brand": brand_name, "overall_visibility_pct": visibility_pct, "probes": probe_results}
    resp = await asyncio.to_thread(
        lambda: bedrock.converse(
            modelId=ORCHESTRATOR_MODEL,
            system=[{"text": ANALYSIS_PROMPT}],
            messages=[{"role": "user", "content": [{"text": json.dumps(payload)}]}],
            inferenceConfig={"maxTokens": 1024, "temperature": 0.3},
        )
    )
    raw = resp["output"]["message"]["content"][0]["text"].strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1].removeprefix("json").strip()
    try:
        d = json.loads(raw)
        return {"summary": d.get("summary", ""), "key_findings": d.get("key_findings", [])}
    except (json.JSONDecodeError, IndexError):
        return {"summary": f"{brand_name} scored {visibility_pct}% AI visibility across probes.", "key_findings": []}


async def _verify_entity(bedrock, name: str, industry: str | None, web_context: str) -> bool:
    """Cheap check: does the web_context actually describe a company called `name`
    (in `industry`, if given)? Guards against auditing a different same-named entity
    when the data came from a name-based search rather than the brand's own domain.
    Returns True if it's a confident match."""
    prompt = (
        f"A user wants to audit a company called \"{name}\""
        + (f" in the \"{industry}\" industry." if industry and industry != "unknown" else ".")
        + " Here is web search data that was retrieved:\n\n"
        + web_context[:1500]
        + "\n\nDoes this data clearly describe THAT specific company (not a different "
        "company that happens to share the name, and not generic/unrelated results)? "
        'Answer ONLY with JSON: {"match": true|false}.'
    )
    try:
        resp = await asyncio.to_thread(
            lambda: bedrock.converse(
                modelId=ORCHESTRATOR_MODEL,
                messages=[{"role": "user", "content": [{"text": prompt}]}],
                inferenceConfig={"maxTokens": 50, "temperature": 0},
            )
        )
        raw = resp["output"]["message"]["content"][0]["text"].strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].removeprefix("json").strip()
        return bool(json.loads(raw).get("match", False))
    except Exception as e:
        log.warning("entity_verify_failed", brand=name, error=str(e))
        return False  # fail closed: if we can't verify, treat as unconfirmed


class BrandNotConfirmed(Exception):
    """Raised when we cannot confidently identify which company the user means."""


async def orchestrate(session: AsyncSession, brand_id: int, dry_run: bool = False, custom_questions: list[str] | None = None, on_event=None) -> Insight | None:
    """Two-phase audit: (A) a stronger model writes buyer questions grounded in live
    web context, (B) probes run in parallel across the model panel and a fast model
    writes the factual summary. Returns the saved Insight, or None on dry_run."""
    def emit(msg: str):
        if on_event:
            try:
                on_event(msg)
            except Exception:
                pass

    bedrock = _bedrock_client()
    brand = await session.get(Brand, brand_id)
    target_brand = brand.name if brand else ""
    model_hits: dict[str, list[bool]] = {}  # {model: [mentioned_per_probe]}

    log.info("orchestrate_start", brand_id=brand_id, dry_run=dry_run)
    emit("Starting audit…")

    # --- Phase A: understand the brand, then write the questions (stronger model) ---
    emit("Searching the web for brand context…")
    context = await _get_brand_context_tool(session, brand_id)
    source = context.pop("_source", "none")

    # Entity-resolution gate. The brand's own homepage is authoritative. But a
    # name-based search can return a DIFFERENT company with the same name (e.g. an
    # obscure 20-person startup vs a bigger namesake) — auditing that is worse than
    # no answer. So when we only have search data (no trusted domain), verify the
    # match; if it fails, stop and ask the user for a domain rather than fake a score.
    if source != "homepage":
        web_ctx = context.get("web_context", "")
        if not web_ctx:
            log.warning("brand_unconfirmed_no_data", brand_id=brand_id, name=target_brand)
            raise BrandNotConfirmed(target_brand)
        emit("Confirming brand identity…")
        if not await _verify_entity(bedrock, target_brand, context.get("industry"), web_ctx):
            log.warning("brand_unconfirmed_mismatch", brand_id=brand_id, name=target_brand)
            raise BrandNotConfirmed(target_brand)

    emit("Gathered brand context. Generating questions…")
    questions = await _generate_questions(bedrock, context, custom_questions)
    if not questions:
        log.error("no_questions_generated", brand_id=brand_id)
        return None

    if dry_run:
        for q in questions:
            log.info("dry_run_probe", prompt=q)
        log.info("dry_run_complete", count=len(questions))
        return None

    # --- Phase B: run every question across the model panel (parallel), collect results ---
    # CRITICAL: only "category" questions (which do NOT name the brand) count toward the
    # visibility score — that measures whether the brand surfaces ORGANICALLY when a buyer
    # asks about the category. "Brand-direct" questions (which name the brand) are run for
    # the detail view but excluded from scoring, since a model trivially echoes a name we
    # handed it (that would inflate every brand toward 100% and measure nothing real).
    probe_results = []
    for i, q in enumerate(questions, 1):
        is_brand_direct = _brand_matches(target_brand, q)
        emit(f"Asking {len(MODEL_CONFIGS)} models: \"{q[:60]}…\"")
        result = await _run_probe_tool(session, brand_id, q, target_brand, on_event=emit)
        if not is_brand_direct:
            for model, mentioned in result.get("breakdown", {}).items():
                model_hits.setdefault(model, []).append(mentioned == "yes")
        probe_results.append({
            "question": q, "visibility_pct": result["visibility_pct"],
            "models": result.get("breakdown", {}), "scored": not is_brand_direct,
        })
        emit(f"Probe {i}: {result['visibility_pct']}% visible")
        log.info("probe_done", probe_count=i, visibility_pct=result["visibility_pct"], scored=not is_brand_direct)

    # Visibility = organic mentions on category questions only. If the model generated
    # all brand-direct questions (no category ones), fall back to all so we never divide
    # by zero / show a meaningless 0%.
    if not model_hits:
        for r in probe_results:
            for model, mentioned in r["models"].items():
                model_hits.setdefault(model, []).append(mentioned == "yes")
    visibility_pct = compute_visibility(model_hits)
    model_breakdown = {m: round(sum(h) / len(h) * 100, 1) for m, h in model_hits.items() if h}
    emit(f"Scoring visibility… {visibility_pct}%")

    analysis = await _generate_analysis(bedrock, target_brand, visibility_pct, probe_results)

    insight = Insight(
        brand_id=brand_id,
        summary=analysis["summary"],
        key_findings=analysis.get("key_findings", []),
        recommendations=[],  # Aura measures visibility; it does not advise. Column kept to avoid a migration.
        probe_count=len(questions),
        visibility_pct=visibility_pct,
        model_breakdown=model_breakdown,
        raw_tool_calls=[{"question": q} for q in questions],
    )
    session.add(insight)
    await session.commit()
    log.info("orchestrate_done", brand_id=brand_id, probe_count=len(questions), visibility_pct=visibility_pct)
    return insight
