import asyncio
import hashlib
import json
import os
import re
import structlog
from datetime import datetime

import boto3
import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Brand, Insight, ProbePerformance, ApiCall, Prompt, Run, Mention, SentimentEnum
from src.llm.client import OpenRouterClient, DEFAULT_MODELS
from src.llm.bedrock_client import BedrockClient, BEDROCK_MODELS
from src.llm.extractor import extract_mentions

log = structlog.get_logger()


# Country-code TLD -> human region. A ccTLD is a strong, deterministic signal of a brand's
# home market. Kept to clear cases; generic TLDs (.com/.io/.app) give NO region signal here
# and fall through to the web-context check, then default to Global.
_TLD_REGION = {
    "de": "Germany", "at": "Germany", "ch": "Germany",            # DACH
    "fr": "France", "it": "Italy", "es": "Spain", "pt": "Portugal",
    "nl": "the Netherlands", "be": "Belgium", "se": "Sweden", "no": "Norway",
    "dk": "Denmark", "fi": "Finland", "pl": "Poland", "ie": "Ireland",
    "uk": "the UK", "eu": "Europe",
    "in": "India", "jp": "Japan", "cn": "China", "kr": "South Korea",
    "sg": "Singapore", "ae": "the UAE", "sa": "Saudi Arabia",
    "au": "Australia", "nz": "New Zealand",
    "br": "Brazil", "mx": "Mexico", "ca": "Canada",
}
# Region phrases to look for in the brand's own web context when the TLD is generic.
_REGION_PHRASES = [
    ("Germany", ["based in germany", "headquartered in germany", "german company", "deutschland"]),
    ("Europe", ["across europe", "european markets", "throughout europe", "europe-wide"]),
    ("India", ["based in india", "headquartered in india", "indian company"]),
    ("the UK", ["based in the uk", "based in the united kingdom", "british company"]),
    ("Australia", ["based in australia", "australian company"]),
]


def infer_region(domain: str | None, web_context: str | None) -> str | None:
    """Best-effort home-market detection. Deterministic-first (ccTLD), then a light
    web-context phrase check. Returns a region label (e.g. "Germany", "Europe") or None
    when there's no confident signal — None means "Global" to the caller. Conservative on
    purpose: we never claim a region without clear evidence (the user toggle is the safety
    net for ambiguous .com brands)."""
    if domain:
        host = domain.lower().strip().replace("https://", "").replace("http://", "").replace("www.", "").split("/")[0]
        parts = host.split(".")
        # handle multi-part ccTLDs like co.uk / com.au
        if len(parts) >= 2:
            last2 = ".".join(parts[-2:])
            if last2 in ("co.uk", "org.uk", "ac.uk"):
                return "the UK"
            if last2 in ("com.au", "net.au"):
                return "Australia"
            tld = parts[-1]
            if tld in _TLD_REGION:
                return _TLD_REGION[tld]
    if web_context:
        low = web_context.lower()
        for region, phrases in _REGION_PHRASES:
            if any(p in low for p in phrases):
                return region
    return None


async def _scrape_homepage(name: str, domain: str) -> str | None:
    """Fetch the brand's own homepage (SSRF-safe). This is the ONE source that is
    unambiguously the right company — no entity-confusion risk."""
    safe_url = _safe_https_url(domain)
    if not safe_url:
        log.warning("homepage_fetch_blocked_ssrf", brand=name, domain=domain)
        return None
    try:
        # Follow redirects: most real sites 301 the apex domain to www/ or a region
        # page (notion.so -> www.notion.so, lindt.com -> region). It's the brand's OWN
        # domain (already SSRF-validated above), so following its redirect is safe and
        # correct — without this, any site that redirects fails confirmation entirely.
        async with httpx.AsyncClient(timeout=8, follow_redirects=True, max_redirects=5) as client:
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
        target_mention = next((m for m in extraction.mentions if _brand_matches(target_brand, m.brand_name)), None)
        mentioned = target_mention is not None
        # Capture the COMPETITORS the model named (everyone who isn't the target). This is
        # the evidence that powers the "why competitors won / how to improve" feature — the
        # live audit previously discarded it. Keep name, position, and any cited URLs.
        competitors = [
            {"name": m.brand_name, "position": m.position, "cited_urls": list(getattr(m, "cited_urls", []) or [])}
            for m in extraction.mentions
            if not _brand_matches(target_brand, m.brand_name)
        ]
        if on_event:
            on_event(f"{friendly(model)}: {'✓ mentioned' if mentioned else '✗ not found'}")
        return {
            "model": model, "provider": provider, "mentioned": mentioned, "failed": False,
            "tokens_in": result.get("tokens_in") or 0, "tokens_out": result.get("tokens_out") or 0,
            "latency_ms": result["latency_ms"],
            # Keep the verbatim answer + brand position so the audit can persist them for
            # the "what each AI actually said" reveal (proves results aren't hallucinated).
            "response_text": result["text"],
            "brand_position": target_mention.position if target_mention else None,
            "competitors": competitors,
        }
    except Exception as e:
        log.warning("probe_model_error", model=model, error=str(e))
        return {"model": model, "provider": provider, "mentioned": False, "failed": True,
                "tokens_in": 0, "tokens_out": 0, "latency_ms": 0,
                "response_text": None, "brand_position": None}
    finally:
        if hasattr(client, "close"):
            await client.close()


# Bounds the TOTAL number of in-flight model calls across all probes running
# concurrently. With ~10 probes x 4 models = ~40 calls, a cap of 12 keeps Bedrock
# from throttling while still collapsing the old sequential ~170s into one parallel wave.
_PROBE_CALL_SEMAPHORE = asyncio.Semaphore(12)


async def _probe_all_models(prompt_text: str, target_brand: str, on_event=None) -> list[dict]:
    """Pure I/O: run one probe's prompt across every model in parallel. Touches NO DB —
    so many probes can run this concurrently. Returns the raw per-model result dicts;
    the caller persists them serially on the shared session via `_persist_probe`."""
    async def bounded(p, m):
        async with _PROBE_CALL_SEMAPHORE:
            return await _probe_one_model(p, m, prompt_text, target_brand, on_event=on_event)

    return await asyncio.gather(*[bounded(p, m) for m, p in MODEL_CONFIGS])


def _persist_probe(session: AsyncSession, brand_id: int, prompt_text: str, results: list[dict]) -> tuple[dict, object]:
    """Stage one probe's DB writes on the shared session. Adds the ApiCall rows directly
    (synchronous, safe) and returns (summary, upsert_stmt). The caller awaits the returned
    upsert statement serially, so the async session is only ever touched from one task."""
    model_breakdown = {}
    for r in results:
        tokens_in = r.get("tokens_in") or 0
        tokens_out = r.get("tokens_out") or 0
        cost = (tokens_in * 0.00025 + tokens_out * 0.00125) / 1000 if r["provider"] == "bedrock" else 0.0
        session.add(ApiCall(model=r["model"], provider=r["provider"], latency_ms=r["latency_ms"],
                            tokens_in=tokens_in, tokens_out=tokens_out, cost_usd=cost))
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
    ).on_conflict_do_update(
        constraint="uq_probe_brand_hash",
        set_={
            "run_count": ProbePerformance.run_count + 1,
            "hit_count": ProbePerformance.hit_count + int(hit),
            "last_used": datetime.utcnow(),
        },
    )
    summary = {
        "prompt": prompt_text,
        "models_mentioned": hit_count,
        "models_checked": succeeded,
        "visibility_pct": round(hit_count / succeeded * 100, 1) if succeeded else 0.0,
        "breakdown": {m: "yes" if v else "no" for m, v in model_breakdown.items()},
    }
    return summary, stmt


async def _persist_responses(session: AsyncSession, brand_id: int, prompt_text: str, results: list[dict]) -> None:
    """Persist the verbatim model answers for one question so the brand page can show the
    "what each AI actually said" reveal. Writes a Prompt + one Run per succeeded model +
    a target-brand Mention when found. Best-effort: a duplicate content_hash (same answer
    seen twice across audits) is skipped rather than aborting the whole audit. Called
    serially on the shared session, matching the rest of the persistence path."""
    prompt = Prompt(brand_id=brand_id, text=prompt_text)
    session.add(prompt)
    await session.flush()  # need prompt.id for the runs

    for r in results:
        if r.get("failed") or not r.get("response_text"):
            continue
        text = r["response_text"]
        # Unique per (prompt, model, answer); dedupes if the identical answer recurs.
        chash = hashlib.sha256(f"{prompt.id}|{r['model']}|{text}".encode()).hexdigest()
        existing = await session.scalar(select(Run.id).where(Run.content_hash == chash))
        if existing:
            continue
        run = Run(
            prompt_id=prompt.id, model=r["model"], provider=r["provider"],
            response_text=text, latency_ms=r.get("latency_ms") or 0,
            tokens_in=r.get("tokens_in") or 0, tokens_out=r.get("tokens_out") or 0,
            content_hash=chash,
        )
        session.add(run)
        await session.flush()  # need run.id for the mention
        if r.get("mentioned"):
            session.add(Mention(
                run_id=run.id, brand_name="(target)",
                position=r.get("brand_position") or 0,
                sentiment=SentimentEnum.neutral, is_target_brand=True, cited_urls=[],
            ))
        # Persist the competitors this model named (evidence for the "how to improve"
        # feature). Cap at 6 per run so a chatty answer can't bloat the table.
        for comp in (r.get("competitors") or [])[:6]:
            name = (comp.get("name") or "").strip()[:255]
            if not name:
                continue
            session.add(Mention(
                run_id=run.id, brand_name=name,
                position=comp.get("position") or 0,
                sentiment=SentimentEnum.neutral, is_target_brand=False,
                cited_urls=(comp.get("cited_urls") or [])[:5],
            ))


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


# Category questions are generated WITHOUT the brand name — this is the anti-bias
# core. If the generator knew the brand, it would (even unconsciously) shape questions
# around that brand's strengths, and the brand would surface ~100% of the time. By
# describing only the CATEGORY and a buyer scenario, the questions are neutral, so the
# score reflects whether the brand genuinely surfaces on its own.
CATEGORY_GEN_PROMPT = """You write the questions a REAL BUYER would type into an AI assistant (ChatGPT, Claude, Gemini) when deciding what to buy in a SPECIFIC category. You are deliberately NOT told any brand name — write questions a neutral shopper asks about the category itself.

You are given a CATEGORY. Every question MUST fit a real buyer of THAT category. Match the category's own world — its products, buyers, and the way people actually shop for it. Do not import vocabulary from unrelated categories (a chocolate buyer never asks about integrations or team size; a hotel buyer never asks about pricing tiers per seat).

Examples of how questions track the category (note how each stays in its own world):
- Category "premium chocolate": "what is the best dark chocolate brand for a gift", "which chocolate has the smoothest texture and richest flavor", "what is a good affordable chocolate for everyday snacking".
- Category "electric SUV": "what is the best electric SUV for a family with a long commute", "which electric SUV has the longest range under 60k".
- Category "project management software": "best project management tool for a remote team of 20", "which PM tool is easiest to set up without training".
- Category "boutique hotel, Lisbon": "best boutique hotel in Lisbon for a romantic weekend", "which Lisbon hotel is walkable to the old town and under 200 a night".

Write 8 questions that:
- Fit the given category exactly, covering varied real buyer scenarios (use case, budget, who it's for, a key quality that matters in THIS category, occasion or context).
- Do NOT name or hint at any specific brand. Stay generic to the category.
- Read like a real person: one sentence, under 25 words, plain commas and periods only (never dashes).

Return ONLY JSON: {"questions": ["...", "..."]}. No prose, no markdown fences."""


# Brand-direct questions DO know the brand — these are for the detail view (not scored),
# so it's fine for them to be specific (pricing, integrations, head-to-heads).
BRAND_GEN_PROMPT = """You write 2 specific questions a buyer would ask an AI assistant ABOUT a particular brand they are already considering. You receive the brand's name, industry, and web_context.

Write 2 questions that name the brand directly: e.g. its pricing tiers, a key integration, a compliance question, or a head-to-head vs a real named competitor. Ground them in web_context (no invented numbers). One sentence each, under 25 words, plain punctuation only.

Return ONLY JSON: {"questions": ["...", "..."]}. No prose, no markdown fences."""


async def _gen_questions_from_prompt(bedrock, system_prompt: str, user_text: str, n_hint: int) -> list[str]:
    resp = await asyncio.to_thread(
        lambda: bedrock.converse(
            modelId=QUESTION_MODEL,
            system=[{"text": system_prompt}],
            messages=[{"role": "user", "content": [{"text": user_text}]}],
            inferenceConfig={"maxTokens": 2600, "temperature": 0.7},
        )
    )
    raw = resp["output"]["message"]["content"][0]["text"].strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1].removeprefix("json").strip()
    try:
        generated = json.loads(raw).get("questions", [])
    except (json.JSONDecodeError, KeyError, IndexError):
        # Salvage a truncated array: keep up to the last COMPLETE element, close the
        # JSON, and let json.loads decode it properly (UTF-8 safe).
        generated = []
        cut = raw.rfind('",')
        if cut > 0:
            try:
                generated = json.loads(raw[:cut + 1] + "]}").get("questions", [])
            except (json.JSONDecodeError, KeyError):
                generated = []
        log.warning("question_gen_salvaged", recovered=len(generated), raw=raw[:120])
    return [q for q in generated if isinstance(q, str) and q.strip()][:n_hint]


def _strip_brand(text: str, brand: str) -> str:
    """Remove the brand name from text so we can feed real category context to the
    BLIND category generator without leaking which brand we're measuring."""
    if not text or not brand:
        return text or ""
    return re.sub(rf"(?<![a-z0-9]){re.escape(brand)}(?![a-z0-9])", "the brand", text, flags=re.IGNORECASE)


async def _infer_category(bedrock, name: str, industry: str | None, web_context: str | None) -> str:
    """Derive a short, concrete category label (e.g. "premium chocolate / confectionery",
    "electric SUV", "applicant tracking software") used to GROUND the neutral question
    generator. This is what makes Aura genre-independent: even when the user gave no
    industry or domain, we figure out what the brand actually sells so the category
    questions fit its real market instead of defaulting to generic software.

    The brand name is stripped from any context we pass downstream, but the inference
    step itself may use the name (the label it returns is generic, not brand-shaped)."""
    # A usable explicit industry is the most reliable signal — trust it.
    if industry and industry.strip().lower() not in ("", "unknown", "other"):
        # Still enrich with web context when available, but the industry anchors it.
        if not web_context:
            return industry.strip()
    parts = [f"Brand name: {name}"]
    if industry and industry.strip().lower() not in ("", "unknown", "other"):
        parts.append(f"Stated industry: {industry.strip()}")
    if web_context:
        parts.append(f"Web context: {web_context[:800]}")
    user = "\n".join(parts) + (
        "\n\nIn 2-6 words, name the specific product CATEGORY this brand sells in, as a "
        "buyer would think of it (e.g. 'premium chocolate', 'electric SUV', 'applicant "
        "tracking software', 'boutique hotel in Lisbon'). Return ONLY the category phrase, "
        "no brand name, no punctuation, no explanation."
    )
    try:
        resp = await asyncio.to_thread(
            lambda: bedrock.converse(
                modelId=QUESTION_MODEL,
                messages=[{"role": "user", "content": [{"text": user}]}],
                inferenceConfig={"maxTokens": 30, "temperature": 0.2},
            )
        )
        label = resp["output"]["message"]["content"][0]["text"].strip().strip('".').splitlines()[0]
        label = _strip_brand(label, name).strip()
        if label and len(label) < 60:
            return label
    except Exception as e:
        log.warning("category_infer_failed", brand=name, error=str(e))
    # Fall back to the stated industry, then a safe generic.
    return (industry or "").strip() or "this product category"


async def _generate_questions(bedrock, context: dict, custom_questions: list[str] | None, category_override: str | None = None, region: str | None = None) -> tuple[list[str], str]:
    """Generate the probe set in two BLIND pools to avoid brand-shaped questions:
      - category questions: generated from the inferred CATEGORY ONLY (brand withheld)
        -> neutral, these are what get scored for true organic visibility.
      - brand-direct questions: generated WITH the brand context -> detail view only.
    Custom questions (if any) run first. Returns (questions, inferred_category).
    category_override: if the user confirmed/edited a category in the preview step, use
    it verbatim and skip inference."""
    name = context.get("name", "")
    industry = context.get("industry") or "unknown"
    web_context = context.get("web_context")
    # Ground the neutral questions in the brand's REAL category (genre-independent),
    # derived from industry/web-context. The category label carries no brand name, so
    # the generator stays blind while still asking category-appropriate questions.
    if category_override and category_override.strip():
        category = category_override.strip()[:60]
    else:
        category = await _infer_category(bedrock, name, industry, web_context)
    log.info("category_inferred", brand=name, category=category)
    # Region scoping: when a home market is chosen, frame the buyer questions for THAT
    # market so the models name real LOCAL competitors and the brand is measured fairly in
    # the market it serves. Still brand-blind (no bias) — only the geography is added.
    region_line = ""
    if region and region.strip() and region.strip().lower() not in ("global", "globally", "worldwide"):
        region_line = f" Frame EVERY question for buyers in {region.strip()} (e.g. 'best ... in {region.strip()}')."
    cat_user = (
        f"Category: {category}\n\n"
        f"Write 8 neutral buyer questions for THIS category as JSON.{region_line} Do NOT name any specific brand."
    )
    category_qs = await _gen_questions_from_prompt(bedrock, CATEGORY_GEN_PROMPT, cat_user, 8)

    # Pool 2: brand-direct (knows the brand) — for detail, not scored.
    brand_ctx = {k: context[k] for k in ("name", "industry", "web_context") if k in context}
    brand_user = f"Brand:\n{json.dumps(brand_ctx, indent=2)}\n\nWrite 2 brand-specific questions as JSON."
    brand_direct = await _gen_questions_from_prompt(bedrock, BRAND_GEN_PROMPT, brand_user, 2)

    custom = [q.strip() for q in (custom_questions or []) if q.strip()]
    # custom first, then neutral category (scored), then brand-direct (detail). Cap at 12.
    # Also return the inferred category so the caller can persist it on the brand.
    return (custom + category_qs + brand_direct)[:12], category


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


RECOMMENDATIONS_PROMPT = """You are an AI-search visibility strategist. A brand was INVISIBLE on certain buyer questions — competitors got recommended instead. You are given, for each lost question: the competitors the AI named, and EXCERPTS of the AI's actual answer explaining why it picked them.

Your ONLY job is to read that real evidence and surface the pattern + the concrete fix.

ABSOLUTE RULES — credibility depends on this:
- Use ONLY facts present in the supplied evidence. Cite ONLY competitors and reasons that actually appear in the answer excerpts. NEVER invent a competitor, a reason, a statistic, or a source.
- Every recommendation must point to a SPECIFIC pattern you can see across the evidence (e.g. the AI repeatedly praised winners for X, which the brand isn't associated with).
- The action must be concrete and follow directly from that pattern — not generic ("improve SEO", "create content", "engage on social" are BANNED).
- If the evidence is too thin to ground a specific reason (e.g. no competitors captured), say so honestly in one recommendation rather than inventing.

Return ONLY JSON: {"recommendations": [ {"priority": 1, "gap": "...", "why": "...", "action": "...", "competitors": ["..."]} ]}.
- 2 to 4 recommendations, ranked by leverage (most-lost / strongest-competitor first).
- gap: the theme of questions lost, max 14 words.
- why: what the AI rewarded the winners for, grounded in the excerpts, max 30 words. Name the real competitors.
- action: the specific, concrete next step, max 24 words.
- competitors: the real competitor names from the evidence for this gap.
No prose, no markdown fences."""


async def _generate_recommendations(bedrock, brand_name: str, industry: str | None,
                                    lost_evidence: list[dict]) -> list[dict]:
    """Read the REAL losing-query evidence (competitors who won + verbatim answer excerpts)
    and extract per-brand, grounded recommendations. The evidence is gathered deterministically
    by the caller; the LLM only reasons over it, bound to cite nothing outside it. Returns []
    on any failure (recommendations are additive — never break an audit)."""
    if not lost_evidence:
        return []
    # The ground truth: every competitor name that ACTUALLY appeared in the captured
    # evidence. The model is told to cite only these, but we ENFORCE it below — any
    # competitor it lists that isn't in this real set is dropped (no fabrication reaches
    # the user). Matching is case-insensitive on normalized names.
    def _norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]", "", (s or "").lower())
    real_competitors = {_norm(w) for ev in lost_evidence for w in ev.get("winners", [])}
    payload = {"brand": brand_name, "industry": industry or "unknown", "lost_questions": lost_evidence}
    try:
        resp = await asyncio.to_thread(
            lambda: bedrock.converse(
                modelId=ORCHESTRATOR_MODEL,
                system=[{"text": RECOMMENDATIONS_PROMPT}],
                messages=[{"role": "user", "content": [{"text": json.dumps(payload)[:14000]}]}],
                inferenceConfig={"maxTokens": 1400, "temperature": 0.2},
            )
        )
        raw = resp["output"]["message"]["content"][0]["text"].strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].removeprefix("json").strip()
        recs = json.loads(raw).get("recommendations", [])
        # Keep only well-formed recs; cap length defensively.
        clean = []
        for i, r in enumerate(recs[:4], 1):
            if not isinstance(r, dict) or not r.get("action"):
                continue
            # GROUNDING ENFORCEMENT: keep only competitors that truly appeared in the
            # captured evidence. Drops any name the model invented or mis-attached.
            verified_comps = [str(c)[:80] for c in (r.get("competitors") or [])
                              if _norm(str(c)) in real_competitors][:4]
            clean.append({
                "priority": r.get("priority", i),
                "gap": str(r.get("gap", ""))[:140],
                "why": str(r.get("why", ""))[:280],
                "action": str(r.get("action", ""))[:240],
                "competitors": verified_comps,
            })
        return clean
    except Exception as e:
        log.warning("recommendations_failed", brand=brand_name, error=str(e))
        return []


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


async def preview_audit(session: AsyncSession, brand_id: int) -> dict:
    """Cheap pre-audit step: gather web context, run the entity check, and infer the
    category — WITHOUT running any probes. Lets the UI show the user what Aura
    understood (which brand, which category) and let them confirm/correct it before
    spending a full audit. Returns:
      {found: bool, category: str, summary: str, source: str}
    found=False means we couldn't confidently identify the brand (ask for a domain)."""
    bedrock = _bedrock_client()
    brand = await session.get(Brand, brand_id)
    if not brand:
        raise ValueError(f"Brand {brand_id} not found")
    name = brand.name

    context = await _get_brand_context_tool(session, brand_id)
    source = context.pop("_source", "none")
    web_ctx = context.get("web_context", "")

    # Same entity gate as orchestrate: a name-only search may be a different same-named
    # company, so verify before we claim we found the right one.
    found = True
    if source != "homepage":
        if not web_ctx or not await _verify_entity(bedrock, name, brand.industry, web_ctx):
            found = False

    category = await _infer_category(bedrock, name, brand.industry, web_ctx) if found else ""
    summary = (web_ctx or "")[:240]
    # Detected home market (None = no confident signal = "Global"). Independent of the
    # entity gate: the domain TLD is a valid market signal even when confirmation is unsure.
    # The UI shows this as a pre-selected, one-tap-overridable toggle (smart, never silent).
    detected_region = infer_region(brand.domain, web_ctx)
    return {"found": found, "category": category, "summary": summary,
            "source": source, "detected_region": detected_region}


async def orchestrate(session: AsyncSession, brand_id: int, dry_run: bool = False, custom_questions: list[str] | None = None, category_override: str | None = None, region: str | None = None, on_event=None) -> Insight | None:
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
    questions, inferred_category = await _generate_questions(bedrock, context, custom_questions, category_override=category_override, region=region)
    if not questions:
        log.error("no_questions_generated", brand_id=brand_id)
        return None

    # Persist the inferred category as the brand's industry when the user didn't set
    # one, so the dashboard can show it and future audits reuse it (stable + no
    # re-inference). Never overwrite a user-provided industry. Guard against the
    # generic fallback label so we don't store a non-answer.
    if brand and (not brand.industry or not brand.industry.strip()) and inferred_category \
            and inferred_category != "this product category":
        brand.industry = inferred_category[:100]
        emit(f"Category identified: {inferred_category}")

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
    # Run the model I/O for ALL questions in one concurrent wave (bounded by the call
    # semaphore), then write to the DB serially. This collapses what used to be a
    # sequential ~170s (10 probes x ~17s each) into roughly the latency of a single probe.
    emit(f"Asking {len(MODEL_CONFIGS)} models across {len(questions)} questions…")
    raw_per_question = await asyncio.gather(
        *[_probe_all_models(q, target_brand, on_event=emit) for q in questions]
    )

    probe_results = []
    lost_evidence = []  # deterministic evidence for the "how to improve" feature
    for i, (q, raw) in enumerate(zip(questions, raw_per_question), 1):
        is_brand_direct = _brand_matches(target_brand, q)
        result, upsert_stmt = _persist_probe(session, brand_id, q, raw)
        await session.execute(upsert_stmt)  # serial: one session, one task
        await _persist_responses(session, brand_id, q, raw)  # verbatim answers for the reveal
        if not is_brand_direct:
            for model, mentioned in result.get("breakdown", {}).items():
                model_hits.setdefault(model, []).append(mentioned == "yes")
            # Gather REAL evidence on questions the brand was (mostly) invisible on — at
            # most one model mentioned it — capturing the competitors that won + a verbatim
            # winning answer. Computed deterministically; the LLM only reasons over it later.
            succeeded = [r for r in raw if not r.get("failed")]
            mentions_here = sum(1 for r in succeeded if r.get("mentioned"))
            if succeeded and mentions_here <= 1 and mentions_here < len(succeeded):
                comps = {}
                for r in succeeded:
                    for c in (r.get("competitors") or []):
                        nm = (c.get("name") or "").strip()
                        if nm:
                            comps[nm] = comps.get(nm, 0) + 1
                top_comps = [n for n, _ in sorted(comps.items(), key=lambda x: -x[1])[:5]]
                # Representative excerpt: the richest answer from a model that did NOT name
                # the brand (a genuine competitor-win answer explaining why).
                excerpt = ""
                losers = [r for r in succeeded if not r.get("mentioned") and r.get("response_text")]
                cand = max(losers, key=lambda r: len(r["response_text"]), default=None)
                if cand:
                    excerpt = cand["response_text"][:600]
                if top_comps:
                    lost_evidence.append({"question": q, "winners": top_comps, "ai_answer_excerpt": excerpt})
        probe_results.append({
            "question": q, "visibility_pct": result["visibility_pct"],
            "models": result.get("breakdown", {}), "scored": not is_brand_direct,
        })
        emit(f"Probe {i}: {result['visibility_pct']}% visible")
        log.info("probe_done", probe_count=i, visibility_pct=result["visibility_pct"], scored=not is_brand_direct)
    await session.flush()

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

    # "How to improve": read the real losing-query evidence (winners + verbatim answers)
    # and surface grounded, per-brand recommendations. Additive — never blocks the audit.
    recommendations = []
    if lost_evidence:
        emit("Analyzing why competitors won…")
        recommendations = await _generate_recommendations(
            bedrock, target_brand, brand.industry if brand else None, lost_evidence[:6]
        )

    insight = Insight(
        brand_id=brand_id,
        summary=analysis["summary"],
        key_findings=analysis.get("key_findings", []),
        recommendations=recommendations,
        probe_count=len(questions),
        visibility_pct=visibility_pct,
        model_breakdown=model_breakdown,
        raw_tool_calls=[{"question": q} for q in questions],
    )
    session.add(insight)
    await session.commit()
    log.info("orchestrate_done", brand_id=brand_id, probe_count=len(questions), visibility_pct=visibility_pct)
    return insight
