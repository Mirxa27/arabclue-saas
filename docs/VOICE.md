# Voice agent (سالم) — call path, media-bridge contract, operations

Twilio is the only live voice path. There is no browser voice client (the old
`/api/voice/session` route was removed), so the site-wide `Permissions-Policy: microphone=()`
stays as it is.

```
Caller → Twilio number (platform account)
  → POST /api/voice/twilio/inbound          X-Twilio-Signature (TWILIO_AUTH_TOKEN), call-time gate
  → <Connect><Stream url=VOICE_BRIDGE_WS_URL><Parameter merchantId/></Stream></Connect>
  → media bridge (ours, external)
      POST /api/voice/bridge/session         → GA Realtime session for this call
      POST /api/voice/webhook (per tool)     → { output } spoken back by the model
```

## Call-time gate (every call, every bridge request)

A call is answered only when **all** hold (`lib/voice/entitlement.ts`):
platform switch `agents.voice.enabled` (/admin/agents) · plan includes voice with an active or
past_due subscription · the merchant's own switch `voice_configs.enabled` (voice page toggle and
the سالم card on the overview drive the same flag). Otherwise the caller hears
"عذراً، هذا الرقم غير متاح حالياً" and the call is logged as `declined` in the merchant's call log.
Merchants cannot write `voice_configs.enabled` through the Data API; `/api/voice/config` and
`/api/agents/status` switch it on only after the gate and when the media bridge is configured.

Without a media bridge (`VOICE_BRIDGE_WS_URL` wss:// **and** `VOICE_BRIDGE_SECRET`) numbers cannot
be bought or switched on (503 `voice_bridge_not_configured`); calls to existing numbers are
forwarded to the store's hand-over number, or told the service is unavailable — never "you'll be
answered shortly".

## Media-bridge contract

Both endpoints require `Authorization: Bearer $VOICE_BRIDGE_SECRET` (503 while unset, 401 wrong).
`callSid` is Twilio's `start.callSid` from the media stream.

`POST /api/voice/bridge/session` `{ merchantId, callSid }`
- `200 { session, greeting, dialect, maxCallSeconds }` — send `{ type: "session.update", session }`
  over the Realtime WebSocket unchanged. `session` is the GA shape (`type: "realtime"`, model
  `gpt-realtime-2.1` or `VOICE_REALTIME_MODEL`, `audio/pcmu` in and out — Twilio's μ-law, no
  transcoding — server VAD, tools). No input transcription is requested; nothing is recorded.
  Enforce `maxCallSeconds` (480).
- `403 { code: "voice_unavailable", reason }` — end the stream (Twilio then hangs up).
- `404 { code: "unknown_call" }` — the SID was not bridged to that merchant (or is > 2 h old).

`POST /api/voice/webhook` `{ merchantId, callSid, call: { name, arguments } }`
- `200 { output }` — feed `output` back to the model as the function result.
- `403 { code: "voice_unavailable", output }` — say `output`, then end the call.
- `404 { code: "unknown_call" }`.
- Send `callSid` with every tool call: order lookups only answer for orders placed with the
  caller id Twilio verified for that call, and bookings / hand-overs use it as the contact and
  callback number. Without it `lookup_order` answers that it cannot verify the caller.

## What the merchant sees (voice page)

`GET/PATCH /api/voice/config` (partial updates only), `GET /api/voice/calls?limit≤200`,
`GET/PATCH /api/voice/bookings`, `GET/PATCH /api/voice/escalations`,
`POST /api/voice/provision-number`. Bookings and hand-overs are confirmed to the caller only when
saved; the owner gets a fixed-copy e-mail (platform sender, ≤ 10 per merchant per hour).

## Numbers and retention (employees-tick cron)

- Account deletion moves the number's SID into `voice_number_releases` (no merchant key, so it
  survives the erasure) and releases it at Twilio; 409 while a purchase is in flight.
- A number whose merchant lost voice (plan / subscription) or uninstalled the Salla app is
  released after 7 days; regaining the plan or reconnecting within that window keeps it.
- Failed releases stay `pending` with `last_error` and back off (5 min doubling, ≤ 12 h); every
  failure is reported. `voice.number_released` events record successes.
- `voice.*` events and the call log are kept 30 days (`prune_voice_records`). Platform events hold
  masked caller numbers and ids only — no names, notes or tool arguments.
