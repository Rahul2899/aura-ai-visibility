# Phase 3 — Next.js: How a Web Dashboard Works

## What Next.js Actually Is

Next.js is a framework built on top of React. React lets you write UI as functions that return HTML-like code (JSX). Next.js adds: routing, server-side rendering, and the build system.

**React** = "describe what the UI looks like based on data"
**Next.js** = "route requests to the right React component, optionally render on the server"

## Server Components vs Client Components

This is the most important Next.js concept. Two different environments:

**Server Component (default):**
- Runs on the server (Node.js process)
- Can fetch data directly — no CORS, no browser needed
- Cannot handle clicks, state, or browser APIs
- Rendered once, sent as HTML to browser

**Client Component (`"use client"` at top of file):**
- Runs in the browser (user's laptop)
- Can handle clicks, state (useState), side effects (useEffect)
- Cannot run server-only code

```
Server Component: page.tsx        ← fetches brands from API, renders table
Client Component: AuditButton.tsx ← handles clicks, polls for status
```

**Why split them?** Server components are faster (data fetches happen server-side, no loading spinner) and more secure (secrets never reach the browser). Client components are needed for anything interactive.

## App Router File Structure

Next.js App Router maps folders → URLs:

```
web/app/
  page.tsx                    → http://localhost:3000/
  brands/
    [id]/
      page.tsx                → http://localhost:3000/brands/1
  compare/
    page.tsx                  → http://localhost:3000/compare
```

`[id]` in brackets = dynamic segment. `params.id` gives you the value.

**Breaking change in Next.js 15+:** `params` became a Promise. Must `await params` before using `params.id`. Bug we hit: skipped this, got `undefined`, brand lookup failed, page showed 404.

## How Data Flows in This Dashboard

```
Browser opens /brands/1
  → Next.js server runs page.tsx (server component)
  → page.tsx fetches from FastAPI: /brands/1/insights, /brands/1/model-bias
  → Renders HTML with the data already in it
  → Sends HTML to browser (fast — data already there)
  → AuditButton.tsx hydrates as client component
  → User clicks "Run Audit" → client-side fetch → polls job status
```

This pattern is called **SSR (Server-Side Rendering)**. The user sees content immediately, not a loading spinner.

## Why Charts Must Be Client Components

`recharts` uses React's `createContext` and renders SVGs — both browser-only. Importing it in a server component throws `createContext is not a function`.

Rule: any library that uses browser APIs, React hooks, or DOM manipulation must be in a `"use client"` component. `VisibilityChart.tsx` got `"use client"` at top.

## CSS Variables vs Tailwind

The design system uses CSS variables defined in `globals.css`:
```css
:root {
  --bg: #08080e;
  --accent: #5c6ef5;
  --green: #22c55e;
}
```

Then in components: `style={{ background: "var(--bg)" }}` or Tailwind classes for spacing/layout.

Why not pure Tailwind? CSS variables let you change the entire theme from one place. Tailwind hardcodes colors at the component level.

## NEXT_PUBLIC_ Variables — Build-Time Baking

Variables starting with `NEXT_PUBLIC_` are embedded into the JavaScript bundle at build time. They work in both server and client components.

**Important:** if you set `NEXT_PUBLIC_API_URL=http://localhost:8000` and run `npm run build`, that URL is baked into the compiled code. You can't change it without rebuilding.

This is why Docker production deployment requires setting the correct API URL BEFORE running `docker compose build`.

## Bugs Hit

**Bug: `createContext is not a function`**
Cause: Imported recharts directly in a server component.
Fix: Moved chart to `VisibilityChart.tsx` with `"use client"`.
Lesson: recharts = browser-only. Server can't render it.

**Bug: Brand page showed 404**
Cause: `params.id` was `undefined` in Next.js 16. `Number(undefined) = NaN`, no brand matched, `notFound()` fired.
Fix: `const { id } = await params` — params is a Promise in Next.js 15+.
Lesson: Always check migration guides when upgrading major versions.

**Bug: Home page showed "Loading..." forever**
Cause: The `/brands/compare` API call was hanging because FastAPI wasn't running.
Lesson: Next.js client components show loading state when fetch never resolves. Always check the API server is actually running before debugging the frontend.

## Key UI/UX Decisions

**Competitive race chart:** Horizontal bars, color-coded green/amber/red. Shows all brands in one view. This is the "moment of truth" — a marketer opens this and immediately sees their rank.

**Animated score ring:** Counts up from 0 on page load. Creates anticipation. Signals "live data" not static.

**Rank badge:** "#1 of 4 tracked brands" — gamification. Turns a number into a competitive position.

**Collapsed audit history:** The history is there but hidden. Most users want current state, not history. `<details>` element = zero JavaScript needed.

## What I Learned
- Next.js App Router maps folders to URLs. No configuration file needed.
- Server components = faster, more secure. Client components = interactive.
- `NEXT_PUBLIC_*` vars are build-time constants. Know this before Docker.
- CSS variables for theming, Tailwind for layout/spacing. Mixing both is fine.
- `recharts` and any library using browser APIs must be in client components.
