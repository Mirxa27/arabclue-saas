# Setup guide

End-to-end walkthrough to get `arabclue` running locally and in production. Plan ~90 minutes for a clean first run.

---

## 1. Prerequisites

- Node.js 20+
- npm (or pnpm)
- A free [Supabase](https://supabase.com) project
- A [Salla Partners](https://salla.partners/) developer account
- An OpenAI API key (or Anthropic; both supported)
- Optional: Wathq beneficiary key, Meta/X/LinkedIn/TikTok developer apps

---

## 2. Clone & install

```bash
git clone https://github.com/Mirxa27/claude-arabclue.git
cd claude-arabclue
npm install
cp .env.example .env.local
```

---

## 3. Supabase

### 3.1 Create the project

1. New project at supabase.com → choose the `eu-west-1` or `eu-central-1` region (closest to KSA until the AWS Bahrain region is in our hot path).
2. Copy from **Project Settings → API**:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` *(server only, never expose)*

### 3.2 Run migrations

```bash
npx supabase link --project-ref <YOUR_REF>
npx supabase db push
```

### 3.3 Configure auth

- **Authentication → URL Configuration**:
  - Site URL: `http://localhost:3000` (dev) / `https://arabclue.com` (prod)
  - Redirect URLs: `http://localhost:3000/dashboard`, `https://arabclue.com/dashboard`, `https://arabclue.com/welcome`
- **Authentication → Providers → Email**: enable Magic Link.

---

## 4. AI provider keys

Add at least one of:

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

For PDPL-residency calls (sensitive data), wire HUMAIN once their B2B endpoint is exposed:

```env
HUMAIN_API_BASE=https://api.humain.ai/v1
HUMAIN_API_KEY=...
```

---

## 5. Salla App

### 5.1 Register the app

1. Sign in at [salla.partners](https://salla.partners/).
2. **Apps → Create App** → choose **Custom App** for testing or **Public App** when you're ready to list.
3. Set **Redirect URL** to `https://<your-domain>/api/salla/oauth/callback` (or `http://localhost:3000/api/salla/oauth/callback` for dev).
4. **Permissions/Scopes** required:
   - `offline_access`
   - `products.read`
   - `orders.read`
   - `orders.read_write` (if you'll mirror invoice IDs back)
   - `settings.read`
5. Copy **Client ID** + **Client Secret** + **Webhook Secret** into `.env.local`.

### 5.2 Webhooks

Configure these to point at `https://<your-domain>/api/salla/webhook`:

- `app.installed`
- `app.uninstalled`
- `order.created`
- `order.updated`

Salla signs every payload with HMAC-SHA256; the secret is `SALLA_WEBHOOK_SECRET`.

---

## 6. ZATCA

### 6.1 Sandbox onboarding

1. Get a developer account at [zatca.gov.sa](https://zatca.gov.sa/en/E-Invoicing).
2. Generate an OTP from the Fatoora developer portal.
3. The first time a merchant connects, the dashboard prompts for the OTP and the system:
   - Generates a CSR (Certificate Signing Request) on the server.
   - Submits to ZATCA `/compliance` to get a compliance CSID.
   - Submits to ZATCA `/production/csids` to upgrade to a production CSID.
   - Stores the production CSID encrypted against the merchant row.

### 6.2 Production switch

Once you're a registered VAT payer with a valid production CSID, set:

```env
ZATCA_FATOORA_BASE=https://gw-fatoora.zatca.gov.sa
```

(Sandbox base is `https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal`.)

---

## 7. Social platform connectors

All are **optional** at first run — the dashboard surfaces missing connections.

| Platform | Required env keys | Notes |
|---|---|---|
| Meta (IG/FB) | `META_APP_ID`, `META_APP_SECRET`, `META_PAGE_ACCESS_TOKEN`, `META_IG_USER_ID` | App must pass Meta App Review for `instagram_content_publish`. |
| WhatsApp Business | `WHATSAPP_PHONE_ID`, `WHATSAPP_ACCESS_TOKEN` | Templates must be pre-approved. Never freeform marketing. |
| TikTok | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_ACCESS_TOKEN` | App must pass TikTok review. |
| LinkedIn | `LINKEDIN_ACTOR_URN`, `LINKEDIN_ACCESS_TOKEN` | Use Company Pages permissions. |
| X | `X_BEARER` | OAuth 2.0 user context preferred for posting. |

---

## 8. Run locally

```bash
npm run dev
# → http://localhost:3000
```

Test flows:
1. Open `/signup` → check inbox → click magic link → land on `/welcome`.
2. Complete the 4-step wizard → land on `/dashboard`.
3. Click **Integrations → Connect Salla** → OAuth round-trip → return to `/dashboard?installed=1`.
4. Go to **Brand Kit** → fill it in → save.
5. Go to **Social Calendar** → click **Generate plan** → 30-day grid appears.

---

## 9. Tests

```bash
npm run typecheck
npm test
```

---

## 10. Production deploy

See [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## Troubleshooting

**Magic links go to spam.** Configure Supabase SMTP with your own SendGrid/Resend creds — the default Supabase SMTP is rate-limited.

**Salla OAuth returns "redirect_uri_mismatch".** The URI in the Salla app config must match the value in `SALLA_REDIRECT_URI` *exactly*, including protocol and trailing slash.

**ZATCA compliance returns 400.** Most common cause: CSR subject DN doesn't match ZATCA's exact field order. The CSR builder in `lib/zatca/signing.ts` follows the official template — verify your VAT number is 15 digits and your `commonName` matches the registered name.

**Social posts schedule but never publish.** Check Vercel Cron logs — the cron secret must match `CRON_SECRET` in env.
