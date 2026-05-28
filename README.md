# arabclue

> Your **دليل** (dalīl — clue, guide, evidence, proof) for trading in Arabia.
> Arabic-first AI ops copilot for Saudi & GCC SMBs.

[![Built for Vision 2030](https://img.shields.io/badge/Built%20for-Vision%202030-0F4D3E)](https://www.vision2030.gov.sa/)
[![PDPL aware](https://img.shields.io/badge/PDPL-aware-1A1A1A)](https://sdaia.gov.sa/en/SDAIA/about/Pages/AboutPersonalDataProtectionLaw.aspx)
[![Salla app](https://img.shields.io/badge/Distribution-Salla%20App%20Store-7E22CE)](https://salla.partners/)

---

## What this is

A four-module operations layer that a Saudi SMB installs once and runs everything through:

| # | Module | What it replaces | Tier |
|---|---|---|---|
| ٠١ | **ZATCA Invoicing** — TLV QR, UUID, UBL XML, hash-chained ICV/PIH, Fatoora submission | Manual Fatoora portal or SAR 200/mo invoicing apps | Lite + |
| ٠٢ | **Agentic Social Media** — five-agent system (planner / copywriter / visualist / scheduler / engager) across IG, TikTok, X, Snapchat, LinkedIn, WhatsApp | SAR 5,000/mo social agency | Plus + |
| ٠٣ | **Gulf-Dialect Voice Agent** — OpenAI Realtime with Khaliji dialect + STC/Twilio number | Missed calls or SAR 2,500/mo answering service | Plus + |
| ٠٤ | **Arabic SEO & Product Copy** — native Arabic copy that ranks in Google KSA | SAR 1,500/mo content retainer | Plus + |
| + | **Wathq B2B Intelligence** — CR enrichment, AOA lookup, GOSI bands | Manual MoCI portal lookups | Pro |

---

## Architecture

```
arabclue/
├── app/
│   ├── page.tsx                      ← bilingual marketing site
│   ├── (dashboard)/                  ← merchant console
│   └── api/
│       ├── salla/
│       │   ├── oauth/callback/       ← merchant install flow
│       │   └── webhook/              ← order.created → ZATCA invoice
│       └── cron/social-scheduler/    ← Vercel Cron, every 15 min
├── lib/
│   ├── ai/providers.ts               ← OpenAI / Anthropic / HUMAIN swap, PDPL-aware
│   ├── social/
│   │   ├── types.ts                  ← Zod schemas
│   │   ├── calendar.ts               ← Saudi calendar of moments
│   │   ├── agent.ts                  ← five-agent pipeline
│   │   └── connectors.ts             ← Meta / X / LinkedIn / TikTok / WhatsApp
│   ├── zatca/invoice.ts              ← TLV QR + UBL XML generator
│   ├── salla/oauth.ts                ← OAuth + HMAC webhook verifier
│   ├── wathq/client.ts               ← CR enrichment with caching
│   └── db/supabase.ts                ← server client
└── supabase/migrations/0001_init.sql ← merchants, invoices, social_posts, …
```

### The social agent pipeline

```
catalog + brand voice + Saudi calendar
            │
            ▼
       PLANNER  ──┐
            │     │  array of PlannedPost (30-day grid)
            ▼     │
       COPYWRITER ┤  per-platform Copy {caption, alt, cta, hashtags}
            │     │
            ▼     │
       VISUALIST ─┘  VisualBrief {layout, slides, palette}
            │
            ▼
     scheduled in social_posts table
            │
            ▼  (Vercel Cron every 15 min)
       SCHEDULER ─→ Meta / X / LinkedIn / TikTok / WhatsApp
                    │
                    ▼
                 ENGAGER ← incoming DM / comment → reply | escalate | ignore
```

---

## Quick start

```bash
# 1. Install
git clone https://github.com/Mirxa27/arabclue.git
cd arabclue
npm install

# 2. Configure
cp .env.example .env.local
# fill OPENAI_API_KEY + Supabase URL/keys at minimum

# 3. Initialise the database
supabase init
supabase link --project-ref <your-project-ref>
supabase db push

# 4. Run
npm run dev      # http://localhost:3000
```

---

## Push to GitHub

```bash
cd arabclue
git init
git add .
git commit -m "feat: initial arabclue scaffold"
git branch -M main
git remote add origin git@github.com:Mirxa27/arabclue.git
git push -u origin main
```

Then connect the repo in your **Vercel** dashboard → one-click deploy. The `vercel.json` already pins the cron schedule.

---

## Go-to-market wedge (30 days)

| Day | Action | Outcome |
|---|---|---|
| 1–3 | Form legal wrapper (Freelance Work Document if Saudi national; US LLC via Stripe Atlas if expat). Open Moyasar (KSA) + Paddle (global) accounts. | Can collect SAR + USD legally. |
| 4–7 | Apply to Salla Partner Portal. Set up sandbox store. Wire the OAuth callback in `app/api/salla/oauth/callback/route.ts`. | Distribution channel open. |
| 8–14 | Ship the **Lite** plan only — ZATCA invoicing module — at SAR 99/month. Submit to Salla App Store. | First buyers reachable. |
| 15–21 | Publish 5 Arabic blog posts targeting ZATCA Wave 24 (`/blog/zatca-wave-24-deadline`, `/blog/fatoora-explained-arabic`, etc.). LinkedIn outbound to 100 Saudi accountants. | Inbound pipeline. |
| 22–30 | Onboard first 20 merchants. Begin building the social agent in branch `feat/social-agent`. | ~SAR 2,000 MRR. |

---

## Compliance posture

- **ZATCA Phase 2** — invoice hash-chain (ICV/PIH), UBL 2.1 XML, TLV QR, UUID per invoice.
- **PDPL** — `lib/ai/providers.ts` exposes a `residency` parameter. Calls to OpenAI/Anthropic require explicit consent for cross-border transfer; calls flagged `residency: "ksa"` route to HUMAIN/ALLaM once that endpoint is configured.
- **Maroof** — production deploys must register a Maroof page and embed the badge on the dashboard.
- **Cookie + analytics** — minimal; no third-party trackers beyond Vercel Analytics by default.

---

## License

Source available under the Business Source License 1.1, converting to Apache 2.0 four years after each release. See `LICENSE.md`.

---

## دليل سريع بالعربية

**أرب كلو** هي طبقة عمليات بالذكاء الاصطناعي عربية المنشأ، تخدم منشآت المملكة والخليج:

- ٠١ — فوترة زاتكا متوافقة مع الموجة ٢٤
- ٠٢ — وكلاء وسائل التواصل الاجتماعي
- ٠٣ — وكيل صوتي باللهجة الخليجية
- ٠٤ — محتوى وSEO بالعربية الأصلية

تُوزَّع عبر متجر تطبيقات سلة، تُسعَّر بالريال، وتبدأ بـ ٩٩ ريالاً شهرياً.

> **arabclue هو دليلك في التجارة العربية.**
