# Aura AI — Production Deploy Runbook (EC2)

Manual, watched cutover for the first deploy. Once this succeeds, the GitHub
Actions workflow (`.github/workflows/deploy.yml`) can automate it.

**Infra:** EC2 t2.micro, Ubuntu 22.04, Docker Compose. DuckDNS
`your-app.duckdns.org` → Elastic IP. Caddy is the only public entry
(`:80` + `:443`); `app` and `db` are internal-only.

---

## 0. THE GATE — rotate secrets first (do before anything touches AWS)

The old AWS/OpenRouter/admin/DB secrets have been exposed. Do NOT deploy with them.

- **AWS Bedrock — preferred: IAM role, no keys.**
  1. Create an IAM role (e.g. `aura-ec2-bedrock`) with a least-privilege policy:
     `bedrock:InvokeModel` on the model/inference-profile ARNs for the lineup.
     Probe models: Claude Sonnet 4.6, Nova Pro, Qwen3 32B, NVIDIA Nemotron Super.
     Also enable Claude Haiku 4.5 (analysis/orchestrator model). All in `eu-central-1`.
     NOTE: the model IDs use the `eu.` cross-region-inference prefix — the EC2
     region MUST be `eu-central-1` or every probe fails. The exact IDs are in
     `src/llm/bedrock_client.py` (BEDROCK_MODELS) + `QUESTION_MODEL`/`ORCHESTRATOR_MODEL`
     in `src/agents/orchestrator.py`. Enable these models in the Frankfurt Bedrock
     console first.
  2. Attach it to the EC2 instance (Actions → Security → Modify IAM role).
  3. **Leave `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` OUT of `.env`.** boto3
     (`src/agents/orchestrator.py` `_bedrock_client`) auto-uses the instance role.
  4. Deactivate the previously-exposed AWS access key in IAM (the one currently
     in your local `.env` / `~/.envrc`).
  - *Fallback if you can't use a role:* create fresh keys, put them in `.env`,
    deactivate the old one.
- **OpenRouter:** unused in prod (`DEFAULT_MODELS=[]`). Omit the key, or rotate it.
- **ADMIN_KEY:** generate a NEW random value (e.g. `openssl rand -base64 32`).
- **POSTGRES_PASSWORD:** set a strong value **before the first `up`** (Postgres
  bakes it on first volume init; changing later needs a volume wipe).

## 1. EC2 `.env` (on the box, never committed)

```env
# AWS — omit the two keys if using an IAM role (preferred)
AWS_REGION=eu-central-1   # must match the eu. model IDs in the code
# AWS_ACCESS_KEY_ID=...        # only if NOT using an instance role
# AWS_SECRET_ACCESS_KEY=...

ADMIN_KEY=<new-random-value>

# Postgres
POSTGRES_USER=peec
POSTGRES_PASSWORD=<strong-password>
POSTGRES_DB=peec
# DATABASE_URL is overridden by docker-compose to use the db service host.

# HTTPS + CORS — set to the real domain so Caddy provisions a TLS cert
SITE_ADDRESS=your-app.duckdns.org
ALLOWED_ORIGINS=https://your-app.duckdns.org
NEXT_PUBLIC_API_URL=/api
AUTO_SEED_AUDITS=true
```

## 2. EC2 security group

Inbound: **:80** and **:443** from anywhere (80 is needed for the ACME challenge
and the http→https redirect), **:22** from your IP only. Nothing else — `:8000`
and `:5432` stay closed (Caddy is the only entry).

## 3. First deploy

```bash
ssh ubuntu@<EC2_IP>
# one-time: git clone https://github.com/Rahul2899/aura-ai-visibility.git
cd aura-ai-visibility
# create/verify .env per section 1
./deploy.sh
```

`deploy.sh` pulls master, builds, starts, and smoke-tests. Caddy will fetch a
Let's Encrypt cert automatically on first start (needs DNS pointing at the box
and :80/:443 open).

## 4. Verify (browser + shell)

1. `https://your-app.duckdns.org` loads with a valid cert; `http://` redirects.
2. The 4 example brands show with real scores.
3. Add a brand → audit completes, live feed streams, 4 models respond, 0 Bedrock errors.
4. `https://…/?admin=<NEW_ADMIN_KEY>` → "ADMIN · unlimited"; create a brand works.
5. From your laptop: `curl http://<EC2_IP>:8000/` and `:5432` → refused/timeout.

## 5. Rollback

```bash
git log --oneline -5        # find the previous good commit
git checkout <prev-sha>
docker compose up -d --build
```

## Notes
- t2.micro is tight for 4 concurrent Bedrock audits + Next.js + Postgres. If the
  box OOMs, resize to t3.small — it's a resource issue, not a code issue.
- Certs persist in the `caddy_data` volume across redeploys (avoids LE rate limits).
