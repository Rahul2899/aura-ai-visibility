# MapTheModel — Production Deploy Runbook (GCP Compute Engine)

Manual, watched cutover. Once this succeeds, the GitHub Actions workflow
(`.github/workflows/deploy.yml`) can automate it.

**Infra:** GCP `e2-micro` (always-free tier), Ubuntu 22.04, Docker Compose.
DuckDNS `aurai.duckdns.org` → static external IP. Caddy is the only public
entry (`:80` + `:443`); `app` and `db` are internal-only.

**No cloud provider SDK.** The app needs Postgres (in-compose) and an OpenRouter
API key. Nothing else. It runs on any box with Docker — GCP is a host, not a
dependency, so a future move costs a `docker compose up`.

---

## 0. THE GATE — secrets first

Generate fresh values. Never reuse local-dev secrets in production.

- **OPENROUTER_API_KEY** — required. Get one at https://openrouter.ai/keys.
  The app refuses to boot without it (`_REQUIRED_VARS` in `src/api/main.py`).
  The model panel lives in `DEFAULT_MODELS` (`src/llm/client.py`): GPT-5.4 Mini,
  Gemini 3.7 Flash, Grok 4.3 and Claude Haiku 4.5 — the four assistants buyers
  actually use, from four different labs.
  **Cost:** these are PAID models, so the cap is a spend ceiling, not a quota
  ceiling. One audit ≈ 50 model calls (~10 probes × 4 models + orchestration)
  ≈ **$0.06**, measured over five real audits. Size `GLOBAL_DAILY_AUDIT_CAP`
  against the OpenRouter balance — see section 1. Top up at
  https://openrouter.ai/credits; the app returns a clear error when the balance
  runs out, it does not silently degrade.
- **ADMIN_KEY** — generate a new random value: `openssl rand -base64 32`
- **POSTGRES_PASSWORD** — set a strong value **before the first `up`** (Postgres
  bakes it on first volume init; changing later needs a volume wipe).

## 1. VM `.env` (on the box, never committed)

```env
OPENROUTER_API_KEY=sk-or-...
ADMIN_KEY=<new-random-value>

# Postgres
POSTGRES_USER=peec
POSTGRES_PASSWORD=<strong-password>
POSTGRES_DB=peec
# DATABASE_URL is overridden by docker-compose to use the db service host.

# HTTPS + CORS — set to the real domain so Caddy provisions a TLS cert
SITE_ADDRESS=aurai.duckdns.org
ALLOWED_ORIGINS=https://aurai.duckdns.org
NEXT_PUBLIC_API_URL=/api

# Daily SPEND ceiling: audits x ~$0.06. 5/day ≈ $0.30/day, so a $3 balance lasts
# ~10 days even if the cap is hit daily. Raise it alongside the balance, not ahead.
GLOBAL_DAILY_AUDIT_CAP=5
# Seeding runs a full audit per demo brand and costs real money. Leave false
# unless you want demo data and have the balance for it.
AUTO_SEED_AUDITS=false
```

## 2. Create the VM

Always-free tier requires `e2-micro` in **us-west1, us-central1, or us-east1**
(any other region bills). Standard persistent disk, ≤30GB.

```bash
gcloud compute instances create aura \
  --machine-type=e2-micro \
  --zone=us-central1-a \
  --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-standard \
  --tags=http-server,https-server

# Static IP so DuckDNS doesn't drift on reboot
gcloud compute addresses create aura-ip --region=us-central1
```

Firewall — the `http-server`/`https-server` tags open :80/:443. SSH goes through
`gcloud compute ssh` (IAP), so **no :22 rule is needed**. Confirm nothing else is
open: `:8000` and `:5432` must stay closed — Caddy is the only entry.

## 3. Prepare the box — swap FIRST

`e2-micro` has **1GB RAM**. The old t2.micro (also 1GB) OOMed under
4 concurrent audits + Next.js + Postgres. Two mitigations, both required:

**a) Add swap before anything else:**
```bash
gcloud compute ssh aura --zone=us-central1-a

sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h   # confirm 2GB swap
```

**b) Don't build the Next.js image on the box** — the build is the memory spike,
not the runtime. Build locally, push to Artifact Registry, and have the VM pull.
If you skip this, expect the `web` build to OOM.

Then Docker:
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER && exec su -l $USER
```

## 4. First deploy

```bash
git clone https://github.com/Rahul2899/map-the-model.git
cd map-the-model
# create/verify .env per section 1
./deploy.sh
```

Point DuckDNS at the static IP **before** starting — Caddy needs working DNS and
open :80 to complete the ACME challenge for its Let's Encrypt cert.

## 5. Verify

1. `https://aurai.duckdns.org` loads with a valid cert; `http://` redirects.
2. Add a brand → audit completes, live feed streams, all 4 models respond, 0 errors.
3. `https://…/?admin=<ADMIN_KEY>` → "ADMIN · unlimited"; creating a brand works.
4. From your laptop: `curl http://<VM_IP>:8000/` and `:5432` → refused/timeout.
5. `docker compose logs app | grep -i "rate_limited\|error"` → check whether the
   free tier is throttling. Frequent `rate_limited` means add OpenRouter credit
   or lower `GLOBAL_DAILY_AUDIT_CAP`.

## 6. Rollback

```bash
git log --oneline -5        # find the previous good commit
git checkout <prev-sha>
docker compose up -d --build
```

## Notes
- Certs persist in the `caddy_data` volume across redeploys (avoids LE rate limits).
- Free tier covers **one** `e2-micro` per billing account. A second VM bills.
- Set a **$1 budget alert** (Billing → Budgets & alerts) as a backstop — the
  always-free tier has no hard cutoff, so a misconfigured resource bills silently.
- `_PROBE_CALL_SEMAPHORE` (`src/agents/orchestrator.py`) caps concurrent model
  calls at 6 to stay under free-tier rate limits. Raise it only with paid credit.
