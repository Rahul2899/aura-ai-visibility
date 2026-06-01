# System Design — Learned Through This Project

System design = deciding HOW to build something before building it. Not what code to write, but how the pieces connect.

This project teaches every major system design concept. Here they are, with the actual code as the example.

---

## 1. Separation of Concerns

**Concept:** Each layer does one thing. Layers don't know about each other's internals.

**In this project:**
```
Next.js (web/)          ← "show data to humans"
FastAPI (src/api/)      ← "speak HTTP"
Orchestrator (src/agents/) ← "run AI agents"
Pipeline (src/pipeline/)   ← "run batch audits"
LLM clients (src/llm/)     ← "talk to AI models"
Models (src/models.py)     ← "what data looks like"
DB (src/db.py)             ← "how to connect to Postgres"
```

Each layer only calls the layer below it. The dashboard doesn't know about Bedrock. The LLM client doesn't know about FastAPI. If you swap Bedrock for OpenAI tomorrow, only `bedrock_client.py` changes — nothing else.

**Why it matters:** Without separation, changing one thing breaks everything. With it, you can change any layer independently.

---

## 2. Synchronous vs Asynchronous

**Concept:** Some operations are fast (DB queries = milliseconds). Some are slow (AI model calls = 10-60 seconds). Async lets you run slow operations without blocking fast ones.

**In this project:**
```python
# ASYNC — all LLM calls run concurrently
results = await asyncio.gather(*[probe_model(m) for m in models])
# All 4 models queried at the same time. Total time = slowest model.
# Without async: total time = sum of all models.
```

**Real impact:** 10 probes × 4 models × 5 seconds each = 200 seconds sequential. With async semaphore(10): ~50 seconds.

**The HTTP pattern:** `POST /audit` returns immediately with a `job_id`. The audit runs in the background. Client polls `GET /audit/job_1`. This is called the **async job pattern** — used everywhere: Stripe payments, video processing, email sending.

---

## 3. Stateless vs Stateful

**Concept:** Stateless = server doesn't remember anything between requests. Stateful = server keeps state.

**Our API is stateless** for data: every request fetches fresh from the database.

**Exception:** `_jobs = {}` in `audits.py` is stateful. It lives in server memory. If the server restarts, all jobs are gone.

**Why this is fine here:** Jobs are short-lived (3-5 minutes). If the server restarts mid-audit, the user just retries. Doesn't need to survive restarts.

**When it would be a problem:** If 100 users were running audits and the server crashed, they'd all lose their job status. Solution: store jobs in the database or Redis. For this stage: not worth the complexity.

---

## 4. Database Design

**Concept:** How you structure tables determines how fast and easy your queries are.

**Key design in this project:**

```
Brand (1) ─── has many ──→ Prompts (N)
                              │
                         has many
                              ↓
                            Runs (N) ─── has many ──→ Mentions (N)

Brand (1) ─── has many ──→ Insights (N)
Brand (1) ─── has many ──→ ProbePerformance (N)
```

**Why this structure?**
- `Brand` owns everything → deleting a brand cascades to delete all its data
- `Insight` stores Claude's synthesis separately from raw `Run` data → you can re-run without losing previous insights
- `ProbePerformance` is a separate table because it aggregates across runs — it's a derived cache, not raw data

**Design principle:** One table per "thing." A run is not the same thing as a mention. Keep them separate even if it means more joins.

---

## 5. Caching

**Concept:** Storing results so you don't recompute them.

**In this project:**
```python
# content_hash = SHA256 of (prompt_text + model + date)
chash = _content_hash(prompt.text, model, today)
existing = await session.scalar(select(Run).where(Run.content_hash == chash))
if existing:
    return  # already ran this today, skip
```

This is **idempotency caching**: if you run the same audit twice on the same day, the second run skips API calls for combinations already computed. Saves money, saves time.

**Real-world equivalent:** This is how any system avoids double-processing: payment systems, data pipelines, email sending.

---

## 6. Rate Limiting

**Concept:** Controlling how much any one user/IP can do, to protect shared resources.

**In this project:**
```python
limit = await session.get(AuditLimit, ip)
if limit and limit.audit_count >= 2:
    raise HTTPException(429, "Too many requests")
limit.audit_count += 1
```

**Why IP and not session?** IPs are harder to fake. Sessions (localStorage) can be cleared by the user.

**What 429 means:** HTTP 429 = "Too Many Requests". Standard rate limit response code.

**Real-world:** Twitter's API rate limits (X requests per 15 minutes), OpenAI's token limits, Stripe's request limits — all the same pattern.

---

## 7. Environment Configuration

**Concept:** Code doesn't contain secrets or environment-specific values. They come from outside.

**In this project:**
```python
# Bad — secrets in code
client = boto3.client("bedrock-runtime", aws_access_key_id="AKIA123...")

# Good — from environment
client = boto3.client(
    "bedrock-runtime",
    aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
)
```

**Why:** Code is public (or shared across teams). Secrets must stay private. Environment variables are set on each machine/server separately.

**The 12-Factor App principle:** Everything that changes between environments (dev/staging/prod) lives in environment variables, not code.

---

## 8. Reverse Proxy

**Concept:** A server that sits in front of your application and routes traffic.

**In this project:** Nginx on port 80 → Next.js on port 3000. Why not expose port 3000 directly?

- Nginx handles SSL termination (HTTPS)
- Nginx can serve static files faster than Node.js
- Nginx is the standard way to expose multiple services on one server
- Nginx can reload config without downtime

**Analogy:** A hotel receptionist. Guests call the hotel (Nginx) and get routed to the right room (service).

---

## 9. Scalability Concepts (Not Built Yet, But Worth Understanding)

**Horizontal scaling:** Run more copies of your server. Our app can't do this yet — `_jobs = {}` lives in one process. Fix: move jobs to Redis or DB.

**Vertical scaling:** Use a bigger server. t2.micro → t2.medium. Easier but more expensive.

**Database bottleneck:** As data grows, queries slow down. Solution: add indexes on frequently queried columns (e.g., `brand_id` FK columns already have implicit indexes).

**CDN:** Serve static assets (images, JS bundles) from servers closer to users. Next.js builds to static files that can be put on CloudFront or Vercel.

---

## The Architecture of This Specific System

```
Internet
    ↓
EC2 server (port 80)
    ↓
Nginx (reverse proxy)
    ↓
Next.js:3000 (frontend)
    ↓ (browser calls)
FastAPI:8000 (backend)
    ↓
Postgres:5432 (storage)

FastAPI also calls:
    → AWS Bedrock (AI models, external API)
    → Claude Haiku (orchestrator, decides what to do)
    → Nova Pro / Llama 3 / Haiku (audit models, queried in parallel)
```

**Data flow for one audit:**
1. User clicks "Run Audit" in browser
2. Browser → `POST /audit/brands/1` → FastAPI returns `job_1`
3. Background task starts: Claude Haiku generates 10 probe questions
4. 10 probes × 4 models = 40 concurrent Bedrock API calls
5. Each response → extractor → brand mention check
6. Claude synthesizes findings → `Insight` saved to Postgres
7. Browser polls `GET /audit/job_1` → sees `status: completed`
8. Page refreshes → Next.js server fetches new insight from FastAPI → renders

That's system design in action. 8 concepts, all visible in one project.
