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

The Graph API version for every Meta call comes from `lib/meta/graph.ts` (default `v26.0`);
override it with `META_GRAPH_VERSION` (env or `/admin/config`). After changing it, smoke-test
Meta OAuth, an Instagram publish and a WhatsApp send.

### 7.1 Webhook authentication (all fail closed)

Every inbound webhook verifies the request before it parses or stores anything. A missing
secret refuses the delivery (**503**) — there is no unauthenticated mode — and a wrong
signature or token gets **403/401** with no database writes and no AI call. Retries are
deduplicated (`webhook_events`), and slow AI work runs after the acknowledgement.

| Webhook | Authenticated by | Secret lives in |
|---|---|---|
| `/api/billing/webhook` (Moyasar) | `secret_token` field in the body | `MOYASAR_WEBHOOK_SECRET` — set the **same value** as the webhook's *secret token* in the Moyasar dashboard |
| `/api/meta/webhook` (platform Meta app) | `X-Hub-Signature-256` | `META_APP_SECRET` |
| `/api/voice/twilio/inbound` | `X-Twilio-Signature` | `TWILIO_AUTH_TOKEN` |
| `/api/voice/webhook` (telephony bridge) | `Authorization: Bearer` | `VOICE_BRIDGE_SECRET` |
| `/api/social/inbound` (internal automation) | `Authorization: Bearer` | `SOCIAL_INBOUND_SECRET`, else `CRON_SECRET` |
| `/api/employees/webhooks/whatsapp/{employeeId}` | `X-Hub-Signature-256` | the integration's `app_secret` (OAuth-connected: `META_APP_SECRET`) |
| `/api/employees/webhooks/meta/{employeeId}` (Messenger + Instagram) | `X-Hub-Signature-256` | the integration's `app_secret` (else `META_APP_SECRET`) |
| `/api/employees/webhooks/slack/{employeeId}` | `X-Slack-Signature` | the integration's `signing_secret`, else `SLACK_SIGNING_SECRET` |
| `/api/employees/webhooks/telegram/{employeeId}` | `X-Telegram-Bot-Api-Secret-Token` | generated when the bot is connected |
| `/api/employees/webhooks/sms/{employeeId}` | `X-Twilio-Signature` | the integration's `auth_token` |

Twilio signs the exact URL it calls, so register Twilio webhooks with the same origin as
`NEXT_PUBLIC_SITE_URL` (number provisioning does this automatically). Telegram webhooks are
registered at `NEXT_PUBLIC_SITE_URL` when the bot is connected — connecting fails with 503
until it is set.

### 7.2 AI employee: Messenger + Instagram DMs (merchant's own Meta app)

Each merchant connects their **own** Meta app (Meta delivers a Page's events only to the app
that subscribed the Page, signed with that app's secret). One app serves both channels.

1. In [developers.facebook.com](https://developers.facebook.com/apps) create a **Business** app
   and add the **Messenger** and **Instagram** products.
2. Request the permissions `pages_messaging`, `pages_manage_metadata`, `instagram_basic` and
   `instagram_manage_messages`.
3. **Publish** the app (Meta sends webhooks only to published apps). Until it has **Advanced
   Access** (App Review + Business Verification) only people with a role on the app can DM it.
4. Link the Instagram professional account to the Facebook Page, and in the Instagram app turn
   on **Settings → Messages and story replies → Message controls → Connected tools → Allow access
   to messages**. Without it Meta rejects every Instagram reply.
5. **Conversation Routing:** in the Page's settings (Meta Business Suite → Settings →
   Conversation routing) make this app the **default app** for Messenger and Instagram. On idle
   threads only the default app may send, and while Meta Business AI owns a thread the app
   only receives it on the standby channel — arabclue does not answer standby events.
6. Generate a **Page access token** for the Page (Messenger → API Setup / Graph API Explorer).
7. Connect the channel on the AI employee in arabclue (`POST /api/employees/{id}/integrations`
   with kind `meta` for Messenger or `instagram` for Instagram Direct) with the Page ID, the Page
   access token, the app's **App Secret** (App settings → Basic) and a verify token you choose
   (16+ characters). arabclue checks the token really belongs to that Page, resolves the linked
   Instagram account, subscribes the Page to `messages`, and returns the callback URL.
8. In the Meta app's **Webhooks** settings, for both the **Page** and the **Instagram** objects,
   set the callback URL to `https://<your-domain>/api/employees/webhooks/meta/{employeeId}` and
   the same verify token, click **Verify and save**, then subscribe the field **`messages`**
   (leave `message_echoes` and standby fields off). Save in arabclue first: the verification
   request is refused until the integration exists.
9. Send a DM from a tester account: one reply arrives. Echoes, receipts, reactions,
   attachment-only messages and messages older than 23 h get no reply; threads a person has taken
   over (escalated / snoozed / closed) are stored without an AI reply.

If a reply fails because the connection is broken (expired token, missing permission, Instagram
message access off), the integration is flagged `status = 'error'` with the reason in
`config.error`; incoming DMs are still stored and the merchant reconnects to clear it.

### 7.3 AI employee: WhatsApp, Slack, Telegram, SMS

- **WhatsApp** (own app): enter `phone_number_id`, `access_token`, `verify_token` **and the
  app's `app_secret`** — without the app secret inbound messages are refused (503). Callback:
  `/api/employees/webhooks/whatsapp/{employeeId}`.
- **Slack:** store the app's **signing secret** with the integration (or set `SLACK_SIGNING_SECRET`
  for the platform Slack app). Request URL: `/api/employees/webhooks/slack/{employeeId}`.
- **Telegram:** only the bot token is needed; the webhook and its secret are registered for you.
- **SMS (Twilio):** the integration's Auth Token verifies `X-Twilio-Signature`.

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
