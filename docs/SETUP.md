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

### 3.3 Configure auth (magic-link sign-in)

Sign-in is passwordless. `POST /api/auth/otp` asks Supabase to email a link; the link lands on one of
two routes that turn it into the cookie session and redirect to a validated relative `next` path
(default `/dashboard`):

| Route | Link shape | Works when |
|---|---|---|
| `/auth/confirm` | `?token_hash=…&type=email&next=…` (our email template, below) | **any** browser — including the mail app's in-app browser on phones |
| `/auth/callback` | `?code=…&next=…` (Supabase's default template, PKCE) | only the browser that requested the link (it holds the PKCE code-verifier cookie) |

Failures (expired / already-used link, link opened in another browser, Supabase `error=` params)
redirect to `/login?error=<code>`, which shows a fixed Arabic + English message.

1. **Authentication → URL Configuration**
   - **Site URL**: `http://localhost:3000` (dev) / `https://arabclue.com` (prod). Must match
     `NEXT_PUBLIC_SITE_URL` — the email template builds links from `{{ .SiteURL }}`.
   - **Redirect URLs** (allow-list) — add for each environment:
     - `http://localhost:3000/auth/callback**`, `http://localhost:3000/auth/confirm**`
     - `https://arabclue.com/auth/callback**`, `https://arabclue.com/auth/confirm**`

     The trailing `**` also matches the `?next=…` query the app appends. The old
     `/dashboard` and `/welcome` entries are no longer needed.
2. **Authentication → Providers → Email**: enabled (Magic Link / email OTP on).
3. **Authentication → Email Templates** — replace the body of **Magic Link** (existing users)
   and **Confirm signup** (first sign-in of a new address) so the link goes to `/auth/confirm`
   with the token hash. Keep `{{ .TokenHash }}` exactly as written.

   **Magic Link** — subject: `رابط الدخول إلى arabclue · Your arabclue sign-in link`

   ```html
   <div dir="rtl" lang="ar" style="font-family: Tahoma, Arial, sans-serif">
     <h2>رابط الدخول إلى arabclue</h2>
     <p>اضغط الزر أدناه لتسجيل الدخول. الرابط صالح لمدة ساعة ويُستخدم مرة واحدة.</p>
     <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard">تسجيل الدخول</a></p>
     <p>إن لم تطلب هذا الرابط فتجاهل هذه الرسالة.</p>
   </div>
   <hr>
   <div dir="ltr" lang="en" style="font-family: Arial, sans-serif">
     <h2>Your arabclue sign-in link</h2>
     <p>Click the button below to sign in. The link is valid for one hour and works once.</p>
     <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard">Sign in</a></p>
     <p>If you didn't request this link, you can ignore this email.</p>
   </div>
   ```

   **Confirm signup** — subject: `أكّد بريدك في arabclue · Confirm your arabclue email`

   ```html
   <div dir="rtl" lang="ar" style="font-family: Tahoma, Arial, sans-serif">
     <h2>مرحبًا بك في arabclue</h2>
     <p>اضغط الزر أدناه لتأكيد بريدك الإلكتروني وإكمال إنشاء حسابك.</p>
     <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/welcome">تأكيد البريد الإلكتروني</a></p>
     <p>إن لم تنشئ حسابًا فتجاهل هذه الرسالة.</p>
   </div>
   <hr>
   <div dir="ltr" lang="en" style="font-family: Arial, sans-serif">
     <h2>Welcome to arabclue</h2>
     <p>Click the button below to confirm your email address and finish creating your account.</p>
     <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/welcome">Confirm email</a></p>
     <p>If you didn't create an account, you can ignore this email.</p>
   </div>
   ```

   Supabase sends **Confirm signup** the first time an address signs in, so it lands on onboarding
   (`/welcome`); returning users get **Magic Link** and land on `/dashboard`. `next` in a template
   must be a relative path — absolute URLs (including `{{ .RedirectTo }}`) are ignored and fall back
   to `/dashboard`.

> Until the templates are changed, Supabase's default template still works through `/auth/callback`,
> but only in the browser that requested the link. Magic links that were emailed before this change
> (implicit flow, `#access_token=…`) are finished by `/login` and the landing page via `POST /auth/session`.

Local smoke test (Supabase CLI stack, Mailpit on `:54324`):

```bash
# The endpoint only accepts same-origin JSON (as sent by the login page), hence the Origin header.
curl -s -c jar -b jar -H 'content-type: application/json' -H 'origin: http://localhost:3000' \
  -d '{"email":"you@example.com","mode":"login"}' http://localhost:3000/api/auth/otp
# open the link from Mailpit with the same cookie jar → 303 to /dashboard with sb-* cookies
```

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
3. Pick the OAuth mode under **App Keys** ([docs](https://docs.salla.dev/doc-421118)):
   - **Easy Mode** — the only mode Salla allows for apps published on the App Store. Salla sends the
     tokens to the webhook as `app.store.authorize`; no redirect URL is involved.
   - **Custom Mode** — for development/testing. Set **Redirect URL** to
     `https://<your-domain>/api/salla/oauth/callback` (or `http://localhost:3000/api/salla/oauth/callback`).
4. **Permissions/Scopes** required:
   - `offline_access` (refresh tokens)
   - `products.read`
   - `orders.read`
   - `orders.read_write` (if you'll mirror invoice IDs back)
   - `settings.read`
5. Copy **Client ID** + **Client Secret** + **Webhook Secret** into `.env.local` (`SALLA_CLIENT_ID`,
   `SALLA_CLIENT_SECRET`, `SALLA_WEBHOOK_SECRET`). Custom Mode also needs `SALLA_REDIRECT_URI`; Easy Mode
   needs the App Store install link in `NEXT_PUBLIC_SALLA_INSTALL_URL`
   (`https://s.salla.sa/apps/install/<app-id>`). In production set them in **Admin → Config**.

### 5.2 How a store gets connected

| Path | What happens |
|---|---|
| **Integrations → Connect Salla** without `NEXT_PUBLIC_SALLA_INSTALL_URL` (Custom Mode; needs `SALLA_REDIRECT_URI`) | `GET /api/salla/oauth/start` (signed-in merchant only) → Salla consent → `/api/salla/oauth/callback`. The callback checks the signed state, the `ac_oauth_salla` browser cookie and that the signed-in merchant started the flow, then links the store. |
| **Install from the Salla App Store** (Easy Mode; "Connect Salla" opens `NEXT_PUBLIC_SALLA_INSTALL_URL` when it is set) | Salla posts `app.store.authorize` to the webhook. If the store is already linked, its tokens are replaced; otherwise they are parked (encrypted) in `salla_installs` with the installing Salla user's email from `accounts.salla.sa/oauth2/user/info`. The merchant signs in to arabclue with the **same email** and clicks **Link this store** on the Integrations page. Only the store owner (Salla role `user`), with a confirmed email, within 30 days can claim it — never by a store id from the browser alone. |

A Salla store belongs to at most one arabclue merchant (`store_already_linked` otherwise).

Tokens are stored encrypted (`TOKEN_ENCRYPTION_KEY`) and only ever read through
`getSallaAccessToken` (`lib/salla/tokens.ts`): it refreshes 10 minutes before expiry and after a 401.
Salla refresh tokens are **single-use** (re-using one revokes the whole install), so one worker per
merchant refreshes under a database lease and stores the rotated pair with a compare-and-swap. If
Salla rejects the refresh token (`invalid_grant`) the Integrations page shows **Reconnect Salla**.
Refresh tokens expire after one month without use.

### 5.3 Webhooks

Configure these to point at `https://<your-domain>/api/salla/webhook`:

- `app.store.authorize` (Easy Mode tokens — required for App Store installs)
- `app.installed`
- `app.uninstalled` (clears the store's tokens; reinstalling reconnects the same merchant)
- `order.created` (ZATCA invoice — the order is mapped from Salla's documented payload and must
  reconcile with `amounts.total`; orders that don't are logged as `salla.order.unmapped`, not invoiced)
- `order.updated`

Salla signs every payload with HMAC-SHA256 (`x-salla-signature`); the secret is `SALLA_WEBHOOK_SECRET`.
Without it the webhook answers 503. Token fields are stripped before any payload is written to the
events log.

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
3. Click **Integrations → Connect Salla** → OAuth round-trip → `/integrations/callback?platform=salla&status=success`
   → back on **Integrations** with Salla connected (Custom Mode; see §5.2 for App Store installs).
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
