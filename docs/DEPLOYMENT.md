# Deployment

Production deployment via Vercel + Supabase. ~30 minutes.

---

## 1. Vercel

### 1.1 Import the repo

1. Sign in at [vercel.com](https://vercel.com).
2. **Add New → Project → Import Git Repository** → select `Mirxa27/claude-arabclue`.
3. Framework preset: **Next.js** (auto-detected).
4. Build command: leave default (`next build`).
5. Root directory: `./` (default).

### 1.2 Environment variables

In the import dialog, add every variable from `.env.example` that has a value. The build step uses these — empty values are OK for connectors you haven't wired yet, but `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`) are required for first deploy.

### 1.3 Region

The included `vercel.json` pins functions to `fra1` and `bom1`. These are the closest regions to KSA from Vercel's currently-available list and the right pair for low-latency Salla webhook handling. Update to a KSA-residency region once Vercel exposes one.

### 1.4 Domain

1. **Project → Settings → Domains → Add Domain** → `arabclue.com`.
2. Configure DNS at your registrar:
   - `A` record `@` → `76.76.21.21`
   - `CNAME` record `www` → `cname.vercel-dns.com`
3. Vercel auto-provisions Let's Encrypt SSL.

### 1.5 Cron

The included `vercel.json` registers a cron at `/api/cron/social-scheduler` running every 15 minutes. Set `CRON_SECRET` in env to a strong random string; Vercel includes it in the `Authorization: Bearer …` header automatically when calling cron endpoints.

---

## 2. Supabase production

If you used a free-tier project for development, upgrade to **Pro** before hitting real merchants:
- $25/mo includes daily backups + 7-day PITR.
- Configure custom SMTP for transactional emails.
- Enable **PITR (Point-in-Time Recovery)** for invoice data integrity (ZATCA mandates 6-year retention).

---

## 3. Salla App publishing

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

## 4. ZATCA production CSID

Each merchant onboards through the dashboard:
1. Merchant visits **Settings → ZATCA** → enters their OTP from the Fatoora portal.
2. Server generates CSR, submits to ZATCA, exchanges for a production CSID.
3. CSID stored encrypted, key never leaves the server.

For your *own* (operator) merchant identity — required if you bill via your own VAT registration — onboard once via the same flow.

---

## 5. Maroof (recommended)

1. Register at [maroof.sa](https://maroof.sa) once you have a CR.
2. Add the Maroof badge to the marketing site footer.
3. Maroof's anti-counterfeit checks raise consumer trust for shoppers buying from your KSA merchants downstream.

---

## 6. PDPL & data residency

- Until you have an in-Kingdom data plane: every merchant who signs up must accept the cross-border data transfer DPA at sign-up (already wired into `/welcome` flow — to be backed by a per-merchant `dpa_accepted_at` column).
- Long-term: deploy a Supabase self-host instance in AWS me-south-1 (Bahrain) and migrate production DB. The codebase is region-agnostic; only the Supabase URL changes.

---

## 7. Monitoring

- **Vercel Analytics** — built in.
- **Vercel Log Drains** → Datadog or Logtail.
- **Supabase Logs** → enable for postgres errors and auth events.
- Add **Sentry** (`npm i @sentry/nextjs`) for client + server error tracking.

---

## 8. Backup & disaster recovery

- Supabase PITR covers DB.
- Code: GitHub `main` is source of truth; tag releases.
- ZATCA invoice XMLs: store a duplicate in an S3 bucket (R2/Cloudflare or AWS me-south-1) on every submission — ZATCA mandates 6-year archival.

---

## 9. Cost ceiling (Year 1 estimate)

| Item | Cost |
|---|---|
| Vercel Hobby (initial) → Pro at 100+ paying merchants | $0 → $20/mo |
| Supabase Pro | $25/mo |
| OpenAI API (volume-dependent) | $50–500/mo |
| Domain | ~$15/yr |
| Sentry (optional) | $0 (free tier) |
| **Total at 50 paying merchants** | **~$120/mo against ~SAR 15,000 MRR** |
