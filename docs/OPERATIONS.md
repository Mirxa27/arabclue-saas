# Operations playbook

What to do, in what order, week by week, until you have 200 paying merchants. This is the war plan.

---

## Week 1 — Legal + payment setup

| Day | Action | Done when |
|---|---|---|
| 1 | If KSA national: apply for Freelance Work Document via MHRSD (SAR 100/year). If expat: form US LLC via Stripe Atlas. | License/LLC number in hand. |
| 2 | Open Mercury (or Wise) business bank account. | Account funded. |
| 3 | Sign up for **Moyasar** (KSA SAR billing) AND **Paddle** (global SaaS Merchant-of-Record). | Test charge of SAR 1 succeeds. |
| 4 | Register **Maroof** page with your business name + arabclue.com URL. | Public Maroof URL live. |
| 5 | Register **Salla Partners** developer account; create the arabclue app in *sandbox* mode. | App showing in sandbox store. |
| 6 | Deploy `main` branch to Vercel. Connect arabclue.com. | `https://arabclue.com` resolves. |
| 7 | Set up support@arabclue.com (Google Workspace) + Crisp/Intercom inbox (you have Intercom MCP connected). | First test email replied to. |

---

## Week 2 — Ship the wedge (ZATCA Lite)

| Day | Action |
|---|---|
| 8 | Onboard YOUR OWN business as the first merchant. Test the full Salla → invoice → ZATCA flow end-to-end in sandbox. |
| 9 | Generate 50 sandbox invoices. Verify ICV/PIH chain. Verify TLV QR scans correctly. |
| 10 | Submit Salla App for review with the *Lite* tier only (SAR 99/month). |
| 11 | Publish first 3 Arabic blog posts on arabclue.com: ZATCA Wave 24 explained, Fatoora onboarding walkthrough, common ZATCA rejections. |
| 12 | LinkedIn outbound message #1 to 30 Saudi-based accountants serving SMBs. |
| 13 | LinkedIn outbound message #2 + WhatsApp Business broadcast to 30 Salla merchants in your network. |
| 14 | Review week-1 inbound. Triage any sign-ups. |

---

## Week 3 — Distribution starts

| Day | Action |
|---|---|
| 15–17 | Daily Arabic blog post + LinkedIn post on ZATCA/Salla/Arabic-SEO topics. |
| 18 | Reach out to 5 Saudi Telegram channels for SMB owners — offer free 30-day Plus to the first 5 stores in each. |
| 19 | Twitter/X thread in Arabic: "صراحة: ٧ أخطاء كل تاجر سلة يكررها مع زاتكا" (or equivalent — write something the audience actually wants). |
| 20 | Submit a guest post pitch to Wamda + Magnitt's MENA newsletter — angle: "What 2026's ZATCA Wave 24 will do to SMB tech adoption." |
| 21 | Review week-2 metrics: visits, sign-ups, conversions to paid. |

---

## Week 4 — First paying merchants

By day 30, target:
- **20 paying Lite merchants** (~SAR 2,000 MRR)
- **OR pivot signal**: if <5 paid, switch the wedge to direct sales via Moyasar (no Salla dependency) within 7 days.

Common failure mode: Salla review takes 10+ business days. Mitigation: ship a direct sign-up path on arabclue.com from day 1 so you don't depend on the Salla App Store being live.

---

## Month 2 — Layer the social agent

| Week | Action |
|---|---|
| 5 | Onboard first 5 merchants into a closed beta of the **Plus** tier. Have them connect Meta (IG) first. |
| 6 | Iterate the planner agent prompts based on what beta merchants flag. Tune Khaliji captions. |
| 7 | Open Plus tier to all Lite customers as an upgrade (one-click in dashboard). |
| 8 | Goal: 60 paying merchants. ~25 of them on Plus. ~SAR 10,000 MRR. |

---

## Month 3 — Voice agent

| Week | Action |
|---|---|
| 9 | Sandbox the OpenAI Realtime + Twilio Saudi number combo with one beta merchant. |
| 10 | Tune Khaliji dialect prompts. Build escalation rules. |
| 11 | Soft-launch the voice agent to Plus + Pro tiers. |
| 12 | Goal: 150 paying merchants. ~SAR 30,000 MRR. |

---

## Month 4–6 — Scale

- **Hire 1 part-time Saudi national** as customer success (helps with Nitaqat tier when you incorporate locally).
- **Move data plane to AWS me-south-1** (Bahrain) for PDPL residency on enterprise tier.
- **Open Direction B**: Wathq-powered B2B intelligence, soft-launched on the same domain.
- **File SAIP wordmark** for "arabclue" and "أرب كلو".

---

## Customer support runbook

### Common questions and canned responses

**Q: My invoice was rejected by ZATCA.**
→ Open the invoice in the dashboard, click "View ZATCA response." 90% of rejections are due to invalid VAT number format, malformed postal code, or missing CR number. Fix in Settings → ZATCA tax details.

**Q: The social agent posted something off-brand.**
→ Two fixes: (1) Refine your Brand Kit's `avoid_words`. (2) Edit individual posts before they go live — they're scheduled, not auto-published until cron picks them up.

**Q: I want to switch dialects.**
→ Settings → Brand Kit → Dialect → save. New plans generated from that point will use the new dialect.

**Q: Cancel my subscription.**
→ Salla handles cancellation directly. Settings → Manage subscription. Their data is retained for 90 days after cancellation per our retention policy.

---

## Escalation matrix

| Severity | Response time | Owner |
|---|---|---|
| ZATCA rejection blocking invoicing | 1 hour | You |
| Social agent posted off-brand | 2 hours | You |
| Salla webhook delivery failure | 4 hours | You |
| Billing dispute | 1 working day | Salla support + you |
| PDPL data subject request | 30 days (legal max) | You |

---

## KPI dashboard (week 4 onwards)

Track weekly in a Notion/spreadsheet:
- MRR (SAR)
- Net new paying merchants
- Churn (count and %)
- Invoices generated (volume × ZATCA success rate)
- Social posts published × per-platform success rate
- Support tickets opened / resolved
- Top inbound channel
- Cash runway months

---

## Failure conditions (when to pivot, not push)

Pivot away from Salla-first if:
- Salla revokes app approval or imposes a >25% platform cut.
- HUMAIN releases an SMB-grade Arabic suite with ZATCA bundled, killing your wedge.
- ZATCA delays Wave 24 by more than 12 months, weakening urgency.

In any of those cases, the asset that survives is:
1. The **arabclue.com** domain and content moat.
2. The **agentic social media engine** (Direction B is Wathq B2B intel).
3. The **brand voice** built up in Arabic SEO and LinkedIn.

These aren't tied to Salla. Reuse.
