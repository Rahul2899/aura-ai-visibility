# Phase 2 — FastAPI: Wrapping Python in HTTP

## The Core Concept

Before Phase 2, the only way to run an audit was:
```bash
python -m src.cli orchestrate-audit 1
```

A browser can't run terminal commands. It can only send HTTP requests. FastAPI is the layer that turns Python functions into HTTP endpoints — it's a translator between "web request" and "Python code."

## What HTTP Actually Is

Every time you open a website, your browser sends an HTTP request. There are two parts:

**Method** — what action?
- `GET` = "give me data" (read)
- `POST` = "do something / create" (write)
- `DELETE` = "remove something"

**Path** — which resource?
- `/brands` = the brands collection
- `/brands/1/report` = report for brand #1

Combined: `GET /brands/1/report` = "give me the report for brand 1."

## What FastAPI Does

FastAPI maps HTTP requests to Python functions with a decorator:

```python
@router.get("/brands/{brand_id}/report")
async def get_report(brand_id: int):
    # This function runs when someone sends GET /brands/5/report
    # brand_id = 5 automatically extracted from URL
    return {"visibility": 55.0}
```

That's it. No extra code needed. FastAPI handles:
- Parsing the URL parameters
- Converting Python dict → JSON response
- Returning the right HTTP status codes

## Pydantic Validation — Why It Matters

When someone sends data TO the API (POST request), you need to validate it. Without Pydantic:
```python
# Dangerous — no validation
name = request.body["name"]  # crashes if "name" missing
```

With Pydantic:
```python
class BrandCreate(BaseModel):
    name: str        # required, must be string
    domain: str = "" # optional, defaults to ""
```

If someone sends `{"typo": "Personio"}`, FastAPI returns an error automatically. Your function never runs. This is called input validation at the boundary — you only validate data where it enters from outside.

## The Background Job Pattern

The orchestrated audit takes 3-5 minutes. HTTP connections must complete in under 1 second or the browser gives up.

Solution: don't wait. Return immediately, do the work in the background.

```
Client: POST /audit/brands/1
Server: "OK, here's job_id=job_1" (returns in <1 second)
Client: GET /audit/job_1 (poll every 3 seconds)
Server: "status: running, 4 probes done"
Client: GET /audit/job_1
Server: "status: completed, visibility: 55%"
```

The in-memory dict `_jobs = {}` stores job state. Simple, works for single-process servers.

**Why not a database for jobs?** Jobs are ephemeral — they only exist while the server runs. If the server restarts, jobs are gone anyway. A Python dict is faster and simpler than a DB query for this.

## AI vs Non-AI in This Phase
- Every endpoint is pure data retrieval or state management
- Zero LLM calls in the API layer
- The LLM work already happened during the audit and was saved
- API = just read/write database + manage job state

## Bugs Hit

**Bug: GET /brands/compare returned 404**
Cause: Route `GET /brands/compare` was declared AFTER `GET /brands/{brand_id}/...` routes.
FastAPI matches routes in order. When it saw `/brands/compare`, it tried to match `{brand_id}` first.
Since `brand_id` is typed as `int` and "compare" isn't an int, it correctly falls through — but only because of the type annotation. This is fragile.
Fix: Move `/compare` to be declared FIRST, before any `/{brand_id}` routes.
Lesson: Static route segments (`/compare`) must come before parameterized segments (`/{brand_id}`) in FastAPI router declaration order.

**Bug: DELETE /brands/{id} failed with FK violation**
Cause: Brand has related rows in insights, probe_performance, prompts, runs, mentions. Deleting the Brand row violated foreign key constraints.
Fix: Manual cascade — delete child rows in correct order: insights → probe_performance → mentions → runs → prompts → brand.
Lesson: PostgreSQL enforces FK constraints. Deleting a parent requires deleting all children first, or setting `ON DELETE CASCADE` in the schema.

## What I Learned
- FastAPI is just Python functions with URL decorators. Nothing magic.
- HTTP verbs (GET/POST/DELETE) are a convention, not a rule. GET reads, POST writes — but the server can do anything it wants.
- The background job pattern (return job_id immediately, poll for status) is how every real async system works — Stripe payments, video processing, AI generation.
- Input validation belongs at the boundary (API layer), not scattered through business logic.
