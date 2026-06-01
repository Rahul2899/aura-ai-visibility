# New Features Added by Other AI Sessions (Antigravity/Gemini)

## What Changed

While I (Claude) was working on Phase 3, other AI models made significant changes to the codebase. Here's what they added and what it means.

## 1. Session-Based Multi-Tenancy

**What it means:** Multiple users can use the same deployed app without seeing each other's brands.

**How it works:**
- When you first visit the site, JavaScript generates a random session ID: `sess_abc123xyz`
- This ID is stored in `localStorage` (browser storage that persists across refreshes)
- Every API call sends `?session_id=sess_abc123xyz`
- The server only returns brands that belong to your session ID

**Code location:** `web/app/lib/session.ts`

**Why this matters for production:** Without sessions, all users share all brands. Everyone sees everyone else's data. Sessions make the product multi-tenant — each user has their own private workspace.

**Real-world analogy:** Like how Notion gives each account its own workspace. The database is shared but the data is filtered by user.

## 2. IP-Based Rate Limiting

**What it means:** Public users can only run 2 audits before they hit a wall. Prevents someone from spamming your AWS Bedrock credits.

**How it works:**
1. When `POST /audit/brands/{id}` is called, the server gets the user's IP address
2. It checks the `audit_limits` table: has this IP run 2+ audits?
3. If yes → HTTP 429 ("Too Many Requests") error
4. If no → increment counter, allow the audit

**Table:** `audit_limits(ip_address PK, audit_count, last_audit_at)`

**Important bug we fixed:** This table was missing from migrations. The code existed but the DB table didn't. Every audit would crash with `NoSuchTableError`. We added migration `f1a2b3c4d5e6`.

**Why IP-based and not session-based?** IP addresses are harder to spoof than localStorage session IDs. A user can clear their browser storage to get a new session ID, but they can't easily change their IP.

## 3. Admin Mode

**What it means:** You (the owner) can bypass all rate limits and see all users' brands.

**How it works:**
- Double-click the "AI" logo in the top-left
- A prompt asks for an Admin Key
- Key is stored in localStorage: `aura_admin_key`
- All API calls include `X-Admin-Key: yourkey` header
- Server checks: `if x_admin_key == os.environ.get("ADMIN_KEY", "admin123")`
- Admin bypasses rate limits, sees all brands

**Security note:** The default key is `admin123`. Change this. Set `ADMIN_KEY=something-secure` in your `.env` file before deploying.

**Why this pattern?** Simple admin backdoor without building a full auth system. Appropriate for a tool you own and deploy yourself.

## 4. Example Brands (Stripe, Vercel)

**What it means:** New users see demo data immediately — Stripe at 85% visibility, Vercel at 75%. The app doesn't look empty on first open.

**How it works:** `src/db_seed.py` runs on every server startup. It checks if brand ID 1001 exists. If not, it inserts Stripe and Vercel with pre-built insights (fake but realistic data).

**Why hardcoded IDs (1001, 1002)?** To prevent duplicate seeding. The check is `if Brand.id == 1001 already exists: skip`. If we used auto-increment IDs, we'd need to check by name instead.

**Important:** Users can't delete example brands (`session_id == "example"` check blocks deletion). They can only view them.

## 5. Tests Added

11 test files in `web/__tests__/`. These test frontend components in isolation.

**What they test:**
- `AuditButton.test.tsx` — does the button trigger audits? Does the polling work?
- `ComparisonChart.test.tsx` — does the chart render with data?
- `session.test.ts` — does session ID persist correctly?
- `scalability.test.tsx` — does the UI handle 50+ brands without breaking?

**Run them:**
```bash
cd web && npm test
```

**TypeScript fix needed:** Tests use `@testing-library/jest-dom` matchers (`.toBeInTheDocument()`). These types weren't in tsconfig so `npm run build` would fail. Fixed by excluding `__tests__/` from tsconfig.

## System Design Concept: Why These Features Exist Together

These features form a **freemium usage control system**:

```
Public user
  → Gets session ID (sees own brands only)
  → Limited to 2 audits (protects your AWS credits)
  → Sees example brands (good first impression)

Admin (you)
  → Bypasses all limits
  → Sees all users' brands
  → Can run unlimited audits
```

This is exactly how real SaaS products work at the early stage — simple controls that let you demo the product to strangers without burning your API budget.

## What I Learned
- Multi-tenancy = filtering data by user identifier. Doesn't require separate databases.
- Rate limiting = counting actions per identifier (IP, user ID) and blocking when limit hit.
- Seed data = fake realistic data that makes the product look alive on first open.
- Testing at the component level lets you verify UI behavior without running the whole app.
- Always check that new DB models have corresponding migrations. Code without migration = runtime crash.
