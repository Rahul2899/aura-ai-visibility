# Aura AI — Web frontend

Next.js (App Router) frontend for Aura AI, the LLM brand-visibility audit platform.
It renders the dashboard, the audit live-scan view, brand comparison, and shareable
report pages, talking to the FastAPI backend.

## Running

This app runs as part of the full stack via Docker Compose from the repository root —
see the root [`README.md`](../README.md) and [`DEPLOY.md`](../DEPLOY.md).

For frontend-only local development:

```bash
npm install --legacy-peer-deps
npm run dev     # http://localhost:3000
npm test        # jest
```

The API base URL is configured with `NEXT_PUBLIC_API_URL` (defaults to `/api` behind
Caddy in production, `http://localhost:8000` for local dev).
