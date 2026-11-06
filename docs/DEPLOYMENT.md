# Deployment

Production deployment via **Hostinger Node.js hosting** (recommended) or Vercel preview + **Supabase**. ~30 minutes.

---

## 1. Hostinger (production — arabclue.com)

Hostinger supports Next.js via **Deploy JS application** and allows **unlimited cron frequency** in hPanel (unlike Vercel Hobby, which limits crons to once per day).

### 1.1 Deploy from GitHub or archive

**Option A — Hostinger MCP / hPanel (archive upload)**

1. Zip the repo **without** `node_modules`, `.next`, or `.git` (Hostinger builds on the server).
2. In hPanel → **Websites → arabclue.com → Node.js** (or use MCP `hosting_deployJsApplication`).
3. Set build command: `npm run build`
4. Set start command: `npm run start`
5. Node.js version: **20.x** (≥ 20.9.0). Node 20 is end-of-life upstream; move to **22.x LTS** as soon as hPanel offers it.

> **Runtime notes (Next 15.5.29).**
> - Always run a fresh `npm run build` after upgrading: 15.5.29 writes scoped route-cache seeds and refuses a `.next` built by an older version. Keep `.next/` writable at runtime so prerendered routes can copy their seeds into `.next/server/app/route-cache/`.
> - The image optimizer is disabled (`images.unoptimized: true` in `next.config.mjs`); `/_next/image` returns 404 and `sharp` is never loaded at runtime. `sharp` is pinned to ≥ 0.35.5 via `overrides` only so audits stay clean; its prebuilt binaries need Node ≥ 20.9.0 and glibc ≥ 2.28 should the optimizer ever be re-enabled.
> - Do not upgrade TypeScript to 7.x while on Next 15.5 — the build rejects it.

**Option B — Git deploy**

Connect the GitHub repo `Mirxa27/arabclue-saas` in hPanel if your plan supports Git deployment for Node.js apps.

### 1.2 Environment variables

**Supabase project:** `ufbywuucobjnlukgvyhp` — migrations through `0009_ai_employee_billing` (includes AI employees marketplace + per-seat billing).

**Bootstrap (hPanel only)** — required before the app can load admin-stored secrets:

1. Open **Websites → arabclue.com → Node.js → Environment**.
2. Set minimum bootstrap keys (see table below) plus `TOKEN_ENCRYPTION_KEY` (32+ random chars).
3. Set **Start command:** `npm run start -- -p $PORT`
4. **Redeploy** or restart the Node.js app.

**Everything else** — configure from **`https://arabclue.com/admin/config`** after signing in as a platform admin. Values are encrypted in `platform_settings` and applied at runtime (no hPanel edit needed for Moyasar, OpenAI, Salla, Meta, etc.).

Minimum bootstrap for first boot:

| Variable | Where to set |
|----------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | hPanel (bootstrap) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | hPanel (bootstrap) |
| `SUPABASE_SERVICE_ROLE_KEY` | hPanel (bootstrap) |
| `TOKEN_ENCRYPTION_KEY` | hPanel (bootstrap — encrypts admin-saved secrets) |
| `PLATFORM_ADMIN_EMAILS` | Admin → Config (or hPanel) |
| `NEXT_PUBLIC_SITE_URL` | Admin → Config |
| `OPENAI_API_KEY`, `MOYASAR_*`, `SALLA_*`, OAuth apps, etc. | Admin → Config |
| `CRON_SECRET` | Admin → Config |
| `NEXT_PUBLIC_SALLA_INSTALL_URL` | Admin → Config (rebuild if changed) |
| `TWILIO_*`, `SENTRY_DSN`, `UPSTASH_*` | Admin → Config (optional) |
| `TRUSTED_PROXY_HOPS` | hPanel or Admin → Config (optional, default `1` — see §1.8) |

### 1.3 Cron jobs (Hostinger hPanel)

Vercel Cron is **not** used on Hostinger. Use hPanel **Advanced → Cron Jobs** (or `scripts/hostinger-cron.sh`, which runs both jobs):

| Job | Schedule | Endpoint |
|-----|----------|----------|
| Social scheduler | `*/15 * * * *` | `GET /api/cron/social-scheduler` |
| AI employees tick | `*/5 * * * *` | `GET /api/cron/employees-tick` |

**Auth:** `Authorization: Bearer YOUR_CRON_SECRET` (or `x-cron-secret` / `?secret=`).

The employees tick advances task queues, writes heartbeats, and enforces trial/subscription billing (trial end → `past_due` + `paused`).

**One-liner (social only):**

```bash
curl -fsS -H "Authorization: Bearer YOUR_CRON_SECRET" "https://arabclue.com/api/cron/social-scheduler"
```

**Recommended:** run `scripts/hostinger-cron.sh` every 5 minutes so social (15m effective) and employees (5m) both stay current.

> **hPanel only:** Shared Hostinger SSH does not include the `crontab` command. Create the job under **Advanced → Cron Jobs** in hPanel for `arabclue.com`. Remove any legacy jobs that run `public_html/artisan` (old Laravel app) — those fail with “Could not open input file: artisan”.

After each MCP/hPanel Node.js redeploy, if the site returns **500**, restore Passenger `.htaccess`:

```bash
bash scripts/hostinger-post-deploy.sh
```

(See `scripts/hostinger-public_html.htaccess` — never add `RewriteRule ^(.*)$ public/$1`.)

### 1.4 Webhook URLs (after deploy)

| Service | URL | Authenticated by |
|---------|-----|------------------|
| Moyasar | `https://arabclue.com/api/billing/webhook` | `secret_token` in the body = `MOYASAR_WEBHOOK_SECRET` |
| Salla OAuth | `https://arabclue.com/api/salla/oauth/callback` | signed OAuth state |
| Salla webhooks | `https://arabclue.com/api/salla/webhook` | `SALLA_WEBHOOK_SECRET` |
| Meta (IG / WhatsApp, platform app) | `https://arabclue.com/api/meta/webhook` | `X-Hub-Signature-256` with `META_APP_SECRET` |
| AI employee WhatsApp (per hire) | `https://arabclue.com/api/employees/webhooks/whatsapp/{employeeId}` | `X-Hub-Signature-256` with the integration's `app_secret` |
| AI employee Messenger + Instagram (per hire) | `https://arabclue.com/api/employees/webhooks/meta/{employeeId}` | `X-Hub-Signature-256` with the integration's `app_secret` |
| AI employee Telegram (per hire) | `https://arabclue.com/api/employees/webhooks/telegram/{employeeId}` | secret registered with the bot |
| AI employee Slack (per hire) | `https://arabclue.com/api/employees/webhooks/slack/{employeeId}` | `X-Slack-Signature` (integration `signing_secret` / `SLACK_SIGNING_SECRET`) |
| AI employee SMS (per hire) | `https://arabclue.com/api/employees/webhooks/sms/{employeeId}` | `X-Twilio-Signature` with the integration's Auth Token |
| Twilio voice | `https://arabclue.com/api/voice/twilio/inbound` | `X-Twilio-Signature` with `TWILIO_AUTH_TOKEN` |
| Voice bridge tool calls | `https://arabclue.com/api/voice/webhook` | `Authorization: Bearer $VOICE_BRIDGE_SECRET` |

The Meta row is the **platform** app's callback (comment handover). AI-employee Messenger /
Instagram DMs arrive at the per-hire URL from the merchant's own Meta app (setup:
`docs/SETUP.md` §7.2). Every webhook fails closed: while its secret is unset it answers **503**
and processes nothing, so set `MOYASAR_WEBHOOK_SECRET`, `META_APP_SECRET`, `TWILIO_AUTH_TOKEN`
and `VOICE_BRIDGE_SECRET` (Admin → Config) before pointing providers at production. Telegram
webhooks are registered at `NEXT_PUBLIC_SITE_URL`.

Long AI turns run after the webhook is acknowledged (`after()` from `next/server`). On Hostinger
(`next start`) that work finishes in the same process — stop the app with `SIGTERM`/`SIGINT` and
let it exit rather than killing it, or in-flight replies are lost.

**Health check:** `GET https://arabclue.com/api/health` — public liveness + database reachability (`{ ok, timestamp }`, cached 30 s, rate-limited). Operators get the detailed report (Supabase, Moyasar, OpenAI reachability + git SHA) with `Authorization: Bearer $CRON_SECRET` (or `x-cron-secret`) or a platform-admin session.

**Migrations:** run `npm run db:push` (includes `0007_webhook_idempotency.sql` for webhook dedupe + `voice_configs.twilio_incoming_sid`).

If CLI reports *Remote migration versions not found in local migrations directory* (usually after applying SQL via Supabase Dashboard/MCP with timestamp IDs), repair history then push:

```bash
supabase migration list
supabase migration repair --status reverted <orphan_timestamp_ids...>
supabase migration repair --status applied 0001 0002 0003 0004 0005 0006
npm run db:push
```

Use only the timestamp IDs shown under **Remote** with no matching **Local** row — not placeholder text from error messages.

### 1.5 Social OAuth redirect URIs (developer consoles)

| Platform | Redirect URI |
|----------|----------------|
| Meta | `https://arabclue.com/api/oauth/meta/callback` |
| LinkedIn | `https://arabclue.com/api/oauth/linkedin/callback` |
| X | `https://arabclue.com/api/oauth/x/callback` |
| TikTok | `https://arabclue.com/api/oauth/tiktok/callback` |

Merchants connect channels from **Dashboard → Integrations** (OAuth buttons). Inbound DMs/comments on Meta route to the engager agent and create `social.escalation` events for human handover (same ops desk as voice).

### 1.6 Platform admin panel (`/admin`)

Operators configure agents, inspect env readiness, and test third-party connections from **`https://arabclue.com/admin`**.

1. Set `PLATFORM_ADMIN_EMAILS=you@company.com` in Node.js env (or assign Supabase `app_metadata.role = platform_admin` on a user).
2. Sign in with that account — the dashboard sidebar shows **Admin**.
3. Use **Config** to set API keys and integration secrets (encrypted at rest), run connection tests, and see readiness.
4. Use **Agents** to toggle social/voice/SEO agents and feature flags (stored in `platform_settings`).

Admin API routes (session + platform-admin check): `GET/PATCH /api/admin/config`, `POST /api/admin/test`, `GET /api/admin/stats`, `/api/admin/merchants`, `/api/admin/events`.

### 1.7 Supabase Auth (magic-link sign-in)

Do this once per Supabase project, before the first merchant signs in (full steps and the
Arabic + English email templates: [SETUP.md §3.3](./SETUP.md#33-configure-auth-magic-link-sign-in)):

1. **Authentication → URL Configuration** — Site URL `https://arabclue.com` (same as
   `NEXT_PUBLIC_SITE_URL`); Redirect URLs `https://arabclue.com/auth/callback**` and
   `https://arabclue.com/auth/confirm**`.
2. **Authentication → Email Templates** — Magic Link and Confirm signup link to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=…`, so links work even
   when a phone opens them in the mail app's browser.
3. Configure custom SMTP (§3) — Supabase's built-in mailer is heavily rate-limited.

Smoke test after deploy: request a link on `/login`, open it, and confirm you land on `/dashboard`
(or `/welcome` for a new address). A broken link must end on `/login?error=…` with a readable
message, never a 500.

`/auth/*` and `/api/auth/*` are public routes (the middleware does not gate or refresh them). OAuth
**start** links (`/api/oauth/*/start`, `/api/employees/:id/oauth/:kind/start`) send signed-out
visitors to `/login?next=<start URL>`; callbacks only complete in the browser and account that
started the flow (httpOnly `ac_oauth_<flow>` cookie, `__Host-` prefixed on https).

### 1.8 Client IP for rate limiting (`TRUSTED_PROXY_HOPS`)

Rate limits (OTP sign-in, OAuth starts, analytics, webhooks, billing intents) key on the client IP.
The app never trusts the left-most `X-Forwarded-For` entry, which any client can set. Instead it
takes the entry `TRUSTED_PROXY_HOPS` positions from the **right** — the address written by your
outermost trusted proxy — then falls back to `X-Real-IP`, then `unknown`.

| Deployment | `TRUSTED_PROXY_HOPS` |
|---|---|
| Hostinger Node.js (Passenger / LiteSpeed in front of Node) | `1` (default) |
| Cloudflare (proxied DNS) → Hostinger | `2` |
| Own nginx / Caddy → Node | `1` (the proxy must append `X-Forwarded-For`, e.g. `$proxy_add_x_forwarded_for`) |
| Vercel | ignored — the platform header `x-vercel-forwarded-for` / `x-real-ip` is used |
| Node exposed directly, no proxy (not recommended) | `0` — forwarding headers ignored; IP-keyed limits become shared by all clients |

IPv6 clients are bucketed per `/64`. Limits on authenticated routes can key on the user or
merchant id instead of the IP (`enforceRateLimit(req, scope, limit, windowMs, { identity })`).

---

## 2. Vercel (preview / optional)

> **Note:** Vercel **Hobby** only allows **one cron run per day**. Do not use Vercel Cron for the 15-minute social scheduler on Hobby — use Hostinger cron above.

### 2.1 Import the repo

1. Sign in at [vercel.com](https://vercel.com).
2. **Add New → Project → Import Git Repository** → select `Mirxa27/arabclue-saas`.
3. Framework preset: **Next.js** (auto-detected).

### 2.2 Environment variables

Same as Hostinger section 1.2.

---

## 3. Supabase production

If you used a free-tier project for development, upgrade to **Pro** before hitting real merchants:
- $25/mo includes daily backups + 7-day PITR.
- Configure custom SMTP for transactional emails.
- Enable **PITR (Point-in-Time Recovery)** for invoice data integrity (ZATCA mandates 6-year retention).

---

## 4. Salla App publishing

1. In **Salla Partners → Apps → Your App → Submit for Review**.
2. Required materials (see [SALLA-APP-LISTING.md](./SALLA-APP-LISTING.md)):
   - 5 screenshots (Arabic UI)
   - 1280×720 cover image
   - English + Arabic store descriptions (max 500 chars each)
   - Privacy policy URL (`https://arabclue.com/legal/privacy`)
   - Terms URL (`https://arabclue.com/legal/terms`)
   - Demo account credentials for the reviewer
3. Salla review SLA: 5–10 business days.

---

## 5. ZATCA production CSID

Each merchant onboards through the dashboard:
1. Merchant visits **Settings → ZATCA** → enters their OTP from the Fatoora portal.
2. Server generates CSR, submits to ZATCA, exchanges for a production CSID.
3. CSID stored encrypted, key never leaves the server.

For your *own* (operator) merchant identity — required if you bill via your own VAT registration — onboard once via the same flow.

---

## 6. Maroof (recommended)

1. Register at [maroof.sa](https://maroof.sa) once you have a CR.
2. Add the Maroof badge to the marketing site footer.
3. Maroof's anti-counterfeit checks raise consumer trust for shoppers buying from your KSA merchants downstream.

---

## 7. PDPL & data residency

- Until you have an in-Kingdom data plane: every merchant who signs up must accept the cross-border data transfer DPA at sign-up (already wired into `/welcome` flow — to be backed by a per-merchant `dpa_accepted_at` column).
- Long-term: deploy a Supabase self-host instance in AWS me-south-1 (Bahrain) and migrate production DB. The codebase is region-agnostic; only the Supabase URL changes.

---

## 8. Monitoring

- **Hostinger** — hPanel → Node.js → Logs for runtime errors.
- **Supabase Logs** → enable for postgres errors and auth events.
- Add **Sentry** (`npm i @sentry/nextjs`) for client + server error tracking.

---

## 9. Backup & disaster recovery

- Supabase PITR covers DB.
- Code: GitHub `main` is source of truth; tag releases.
- ZATCA invoice XMLs: store a duplicate in an S3 bucket (R2/Cloudflare or AWS me-south-1) on every submission — ZATCA mandates 6-year archival.

---

## 10. Cost ceiling (Year 1 estimate)

| Item | Cost |
|---|---|
| Hostinger (Node.js hosting) | per your plan |
| Supabase Pro | $25/mo |
| OpenAI API (volume-dependent) | $50–500/mo |
| Domain | ~$15/yr |
| Sentry (optional) | $0 (free tier) |
| **Total at 50 paying merchants** | **~$120/mo against ~SAR 15,000 MRR** |
