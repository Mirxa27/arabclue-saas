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
   - optional: a **secret** API key (`sb_secret_…`, **Project Settings → API Keys**) →
     `SUPABASE_SECRET_KEY` *(server only)* — lets sign-in forward each visitor's IP, see §3.3.

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
| `/auth/confirm` | `?token_hash=…&type=email&next=…[&redirect_to=…]` (our email templates, below) | **any** browser — including the mail app's in-app browser on phones |
| `/auth/callback` | `?code=…&next=…` (Supabase's default template, PKCE) | only the browser that requested the link (it holds the PKCE code-verifier cookie) |

Failures (expired / already-used link, link opened in another browser, Supabase `error=` params)
redirect to `/login?error=<code>`, which shows a fixed Arabic + English message.

`next` is always reduced to a same-origin path (absolute, protocol-relative and dot-segment tricks
such as `/.//evil.example` fall back to `/dashboard`), and the middleware never redirects off-site.

1. **Authentication → URL Configuration**
   - **Site URL**: `http://localhost:3000` (dev) / `https://arabclue.com` (prod). Must match
     `NEXT_PUBLIC_SITE_URL` — the email template builds links from `{{ .SiteURL }}`.
   - **Redirect URLs** (allow-list) — add for each environment:
     - `http://localhost:3000/auth/callback**`, `http://localhost:3000/auth/confirm**`
     - `https://arabclue.com/auth/callback**`, `https://arabclue.com/auth/confirm**`

     The trailing `**` also matches the `?next=…` query the app appends. The old
     `/dashboard` and `/welcome` entries are no longer needed.
2. **Authentication → Providers → Email**: enabled (Magic Link / email OTP on).
3. **Authentication → Email Templates** — replace the body of **Magic Link** (existing users),
   **Confirm signup** (first sign-in of a new address) and **Invite user** so the link goes to
   `/auth/confirm` with the token hash. Keep `{{ .TokenHash }}` and `{{ .RedirectTo }}` exactly as
   written, and keep `redirect_to={{ .RedirectTo }}` the **last** parameter of the Magic Link URL.

   **Magic Link** — subject: `رابط الدخول إلى arabclue · Your arabclue sign-in link`

   ```html
   <div dir="rtl" lang="ar" style="font-family: Tahoma, Arial, sans-serif">
     <h2>رابط الدخول إلى arabclue</h2>
     <p>اضغط الزر أدناه لتسجيل الدخول. الرابط صالح لمدة ساعة ويُستخدم مرة واحدة.</p>
     <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard&redirect_to={{ .RedirectTo }}">تسجيل الدخول</a></p>
     <p>إن لم تطلب هذا الرابط فتجاهل هذه الرسالة.</p>
   </div>
   <hr>
   <div dir="ltr" lang="en" style="font-family: Arial, sans-serif">
     <h2>Your arabclue sign-in link</h2>
     <p>Click the button below to sign in. The link is valid for one hour and works once.</p>
     <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard&redirect_to={{ .RedirectTo }}">Sign in</a></p>
     <p>If you didn't request this link, you can ignore this email.</p>
   </div>
   ```

   `{{ .RedirectTo }}` is the `/auth/callback?next=…` URL the app sent with the request, so a
   sign-in started from a deep link or a "Connect LinkedIn" button returns there. `/auth/confirm`
   only takes `next` from it when it is our own `/auth/callback` URL on the site origin; otherwise
   (for example the bare Site URL, which Supabase uses for links sent from its dashboard) the
   template's `next=/dashboard` applies.

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

   **Invite user** (invites sent from the Supabase dashboard) — subject:
   `دعوة للانضمام إلى arabclue · You're invited to arabclue`

   ```html
   <div dir="rtl" lang="ar" style="font-family: Tahoma, Arial, sans-serif">
     <h2>دعوة للانضمام إلى arabclue</h2>
     <p>اضغط الزر أدناه لقبول الدعوة وإنشاء حسابك.</p>
     <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/welcome">قبول الدعوة</a></p>
   </div>
   <hr>
   <div dir="ltr" lang="en" style="font-family: Arial, sans-serif">
     <h2>You're invited to arabclue</h2>
     <p>Click the button below to accept the invitation and create your account.</p>
     <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/welcome">Accept invitation</a></p>
   </div>
   ```

   Supabase sends **Confirm signup** the first time an address signs in, so it lands on onboarding
   (`/welcome`); returning users get **Magic Link** and land on the page they started from (or
   `/dashboard`). A plain `next` in a template must be a relative path.

> Until the templates are changed, Supabase's default template still works through `/auth/callback`,
> but only in the browser that requested the link. Links in the old implicit-flow format
> (`…#access_token=…`, emailed before the PKCE switch or by Supabase's default **Invite** template)
> are **not** accepted: tokens in a URL fragment are never turned into a session, because anyone can
> link to `/#access_token=<their own tokens>` and sign a visitor into their account. `/` and `/login`
> strip such a fragment from the address bar and show "this link format is no longer supported —
> request a new sign-in link". That is why the Invite template above is required.

4. **Sign-in rate limits.** Every sign-in call reaches Supabase Auth from the app server, so by
   default Supabase's per-IP limits (`/otp`, `/verify`: 30 requests / 5 min) count all merchants
   against the server's one address. To make them per visitor:
   - set `SUPABASE_SECRET_KEY` (`sb_secret_…`; legacy `service_role` JWTs are not accepted for
     this) in the server env — it is used **only** by the sign-in route handlers;
   - enable **Authentication → Rate Limits → IP address forwarding** (or Management API
     `security_sb_forwarded_for_enabled: true`).

   The app then sends the visitor's IP — as resolved by `TRUSTED_PROXY_HOPS`, never the raw
   `X-Forwarded-For` — as `sb-forwarded-for`. Without the key it uses the anon key and forwards
   nothing. Independently, the app caps sign-in itself: 20 link requests per client IP and 3 per
   address (lower-cased, `+tag` and Gmail dots folded) per 15 minutes, and 30 link verifications per
   client IP per 5 minutes. The project-wide email budget is a Supabase setting: use custom SMTP and
   size **Rate Limits → emails sent** to your traffic (the built-in mailer allows only a few per hour).

5. **Same-origin check.** `POST /api/auth/otp` only accepts requests whose `Origin` is the site
   itself: the request origin, `NEXT_PUBLIC_SITE_URL`, or the host the proxy forwarded (`Host` /
   `X-Forwarded-Host`, so self-hosted `next start` behind Passenger works before
   `NEXT_PUBLIC_SITE_URL` is set). A rejection returns `code: "cross_site"` and is logged with the
   origin it saw — if every sign-in fails that way, check the proxy's `Host` forwarding.

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
  reconcile with `amounts.total`; orders that don't, or that carry 0% VAT lines (ZATCA needs an
  exemption reason the payload doesn't have), are logged as `salla.order.unmapped`, not invoiced.
  Orders that can't be invoiced *yet* — store not linked, subscription not active, ZATCA off or not
  onboarded — wait in `pending_salla_orders` and are invoiced later; see §6)
- `order.updated`

Salla signs every payload with HMAC-SHA256 (`x-salla-signature`); the secret is `SALLA_WEBHOOK_SECRET`.
Without it the webhook answers 503. Token fields are stripped before any payload is written to the
events log.

---

## 6. ZATCA (FATOORA Phase 2)

How it works and why: `data/research/zatca-phase2.md` (rules, sources, sandbox transcript).

### 6.1 Configure the environment

```env
ZATCA_ENVIRONMENT=sandbox        # sandbox (developer portal) | simulation | production
# ZATCA_FATOORA_BASE=            # optional override of https://gw-fatoora.zatca.gov.sa/e-invoicing/{developer-portal|simulation|core}
TOKEN_ENCRYPTION_KEY=…           # required: EGS private keys and CSIDs are stored encrypted only
CRON_SECRET=…                    # required for GET /api/zatca/sweep (resends, waiting orders)
```

With neither ZATCA variable set, e-invoicing is off: onboarding answers 503 and Salla orders wait in
`pending_salla_orders`. There is **no platform-wide CSID** — `ZATCA_CSID` / `ZATCA_PRIVATE_KEY_PEM`
are no longer read.

### 6.2 Merchant onboarding (Settings → ZATCA e-invoicing onboarding)

Requires an active (or past-due grace) subscription on a plan with ZATCA, `features.zatca` on, and a
complete tax profile (seller name, VAT number 3…3, street, 4-digit building number, district, city,
5-digit postal code).

1. The merchant generates an OTP in the FATOORA portal (sandbox: ZATCA's documented OTP `123345`).
2. The server generates a secp256k1 key and a CSR (template `TSTZATCA-` / `PREZATCA-` / `ZATCA-Code-Signing`
   per environment) and requests the **compliance CSID** (`POST /compliance`).
3. It signs and submits the six **compliance checks** (standard + simplified × invoice / credit note /
   debit note) to `POST /compliance/invoices`.
4. It requests the **production CSID** (`POST /production/csids`). The key and both CSIDs are stored
   encrypted in `zatca_egs_units` (service role only); the browser only sees step, check results and
   certificate expiry. A failed step is resumed without a new OTP.

Sandbox caveat: the developer portal's production CSID is ZATCA's fixed test certificate for VAT
`399999999900003` — reporting/clearance in the sandbox only accepts that VAT number.

### 6.3 Invoicing

- Each Salla `order.created` → a signed **simplified** invoice (Salla orders have no buyer VAT number),
  reported to ZATCA. Standard (B2B) documents are cleared; ZATCA's stamped XML is stored as the legal
  document (`invoices.cleared_xml`).
- ICV + previous-invoice hash are allocated atomically per merchant (`zatca_append_invoice`); a Salla
  order has at most one live invoice (redeliveries are idempotent).
- Rejected → shown with ZATCA's errors; **Reissue** creates a corrected new document (new ICV/UUID,
  number `…-R1`). Not delivered (timeouts, 5xx) → **Resubmit** resends the same document; the sweep
  cron does it automatically every 10 minutes.

### 6.4 Going live

Move from `sandbox` → `simulation` (FATOORA simulation portal OTPs) → `production`. Merchants onboard
again after each switch (the EGS unit is per environment; the PIH chain restarts, ICVs keep counting).

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
| `/api/employees/webhooks/meta/{employeeId}` (Messenger + Instagram) | `X-Hub-Signature-256` | the integration's `app_secret` (Page token issued by the platform app: `META_APP_SECRET`) |
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
   The App Secret is **required**: Meta signs the webhooks with the secret of the app the Page
   token was generated in. Only a Page token issued by the platform app itself (`META_APP_ID`,
   checked with Meta's `debug_token`) may omit it — that channel is saved with
   `connected_via: "platform"` and verified with `META_APP_SECRET`, and its DMs reach this URL only
   if the platform app's Page / Instagram callback points here (single-merchant deployments; the
   multi-tenant `/api/meta/webhook` does not route DMs to employees).
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

Refused deliveries show in the employee's **Activity** tab (`inbound_rejected`, at most once per
10 minutes per channel and reason): `no_app_secret` — no App Secret is saved for that channel;
`signature_mismatch` — the saved App Secret is not the one of the app sending the webhooks. Only
channels with DM credentials (Page token + Page / Instagram ids) take part; deliveries for a
channel connected only for publishing (Instagram OAuth) are acknowledged and ignored.

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

**ZATCA onboarding fails.** The Settings card shows ZATCA's own message. `Invalid-OTP`: OTPs are single-use and expire after an hour — generate a new one. A failed compliance check lists ZATCA's rule codes (e.g. `BR-KSA-37` building number) — fix the tax details and press *Resume* (no new OTP needed). `certificate-permissions` in the sandbox: use VAT `399999999900003` (§6.2). The CSR is built by `lib/zatca/csr.ts` (structure identical to ZATCA's OpenSSL template, checked by `openssl req -verify` in the tests).

**Social posts schedule but never publish.** Check Vercel Cron logs — the cron secret must match `CRON_SECRET` in env.
