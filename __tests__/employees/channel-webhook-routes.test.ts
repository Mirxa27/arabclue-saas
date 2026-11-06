/**
 * Per-employee channel webhooks — WhatsApp (F03), Slack (F04), Telegram (F29), Twilio SMS.
 * Each: valid signature → processed once in after(); forged/missing → 403 with no claim,
 * no DB write, no AI call; no secret → 503; replay → duplicate; oversized → 413.
 */
import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { DecryptedIntegration } from "@/lib/employees/integration-store";
import type { IntegrationKind } from "@/lib/employees/types";
import { signMetaPayload } from "@/lib/webhooks/meta-signature";
import { createClaimDb, EMPLOYEE_ID, rawPost, runAfterTasks, type AfterTask, type ClaimDb } from "../helpers/webhook-fakes";

const h = vi.hoisted(() => ({
  db: null as unknown as ClaimDb,
  integrations: new Map<string, DecryptedIntegration>(),
  afterTasks: [] as Array<() => unknown>
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (task: unknown) => {
      h.afterTasks.push(typeof task === "function" ? (task as () => unknown) : () => task);
    }
  };
});
vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => h.db.client,
  getServerSupabase: async () => {
    throw new Error("webhooks must not use the user session client");
  }
}));
vi.mock("@/lib/employees/integration-store", () => ({
  loadEmployeeIntegration: vi.fn(async (employeeId: string, kind: string) => {
    const row = h.integrations.get(kind);
    return row && row.employee_id === employeeId && row.status === "connected" ? row : null;
  }),
  loadEmployeeIntegrations: vi.fn(async () => []),
  touchIntegrationLastEvent: vi.fn(async () => undefined),
  markIntegrationError: vi.fn(async () => true)
}));
vi.mock("@/lib/employees/runtime", () => ({
  handleInboundMessage: vi.fn(),
  logAction: vi.fn(async () => undefined)
}));
vi.mock("@/lib/observability/error-reporter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/observability/error-reporter")>();
  return { ...actual, reportError: vi.fn() };
});

import { GET as whatsappGET, POST as whatsappPOST } from "@/app/api/employees/webhooks/whatsapp/[id]/route";
import { POST as slackPOST } from "@/app/api/employees/webhooks/slack/[id]/route";
import { POST as telegramPOST } from "@/app/api/employees/webhooks/telegram/[id]/route";
import { POST as smsPOST } from "@/app/api/employees/webhooks/sms/[id]/route";
import { handleInboundMessage, logAction } from "@/lib/employees/runtime";

const handleMock = vi.mocked(handleInboundMessage);
const ctx = () => ({ params: Promise.resolve({ id: EMPLOYEE_ID }) });
const drain = () => runAfterTasks(h.afterTasks as AfterTask[]);

function integration(kind: IntegrationKind, credentials: Record<string, unknown>, config: Record<string, unknown> = {}): DecryptedIntegration {
  return {
    id: `int-${kind}`,
    employee_id: EMPLOYEE_ID,
    kind,
    external_id: null,
    config,
    status: "connected",
    last_event_at: null,
    created_at: "2026-11-01T00:00:00Z",
    credentials
  };
}

beforeEach(() => {
  h.db = createClaimDb();
  h.integrations.clear();
  h.afterTasks.length = 0;
  vi.clearAllMocks();
  handleMock.mockReset();
  handleMock.mockResolvedValue({ handled: "replied", conversationId: "c", reply: "r", messageId: "m", latencyMs: 1, delivered: true });
});
afterEach(() => {
  delete process.env.META_APP_SECRET;
  delete process.env.SLACK_SIGNING_SECRET;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

function expectRejectedWithoutSideEffects() {
  expect(h.db.claimCalls()).toBe(0);
  expect(h.db.writes()).toEqual([]);
  expect(h.afterTasks).toHaveLength(0);
  expect(handleMock).not.toHaveBeenCalled();
}

// ─── WhatsApp ──────────────────────────────────────────────────────────────

const WA_SECRET = "wa-app-secret-0123456789abcdef";
const WA_URL = `https://arabclue.test/api/employees/webhooks/whatsapp/${EMPLOYEE_ID}`;
const waBody = (id: string, overrides: { from?: string; phoneNumberId?: string; ts?: number; text?: string | null } = {}) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA-1",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "966500000000", phone_number_id: overrides.phoneNumberId ?? "PN-1" },
            contacts: [{ profile: { name: "سارة" }, wa_id: overrides.from ?? "966511111111" }],
            messages: [
              {
                from: overrides.from ?? "966511111111",
                id,
                timestamp: String(overrides.ts ?? Math.floor(Date.now() / 1000) - 5),
                type: overrides.text === null ? "image" : "text",
                ...(overrides.text === null ? { image: { id: "img" } } : { text: { body: overrides.text ?? "السلام عليكم" } })
              }
            ]
          }
        }
      ]
    }
  ]
});
const waRequest = (payload: unknown, secret: string | null) => {
  const raw = JSON.stringify(payload);
  return rawPost(WA_URL, raw, secret ? { "x-hub-signature-256": signMetaPayload(raw, secret) } : {});
};

describe("WhatsApp webhook (F03)", () => {
  beforeEach(() => {
    h.integrations.set(
      "whatsapp",
      integration("whatsapp", { phone_number_id: "PN-1", access_token: "EAAtoken", verify_token: "wa-verify-1", app_secret: WA_SECRET })
    );
  });

  it("processes a signed message once, in after(), with the sender's number", async () => {
    const res = await whatsappPOST(waRequest(waBody("wamid.1"), WA_SECRET), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, accepted: 1, duplicates: 0, skipped: {} });
    expect(handleMock).not.toHaveBeenCalled();
    await drain();
    expect(handleMock).toHaveBeenCalledWith({
      employeeId: EMPLOYEE_ID,
      channel: "whatsapp",
      externalId: "966511111111",
      text: "السلام عليكم",
      contactName: "سارة"
    });
    expect(h.db.claims.get("whatsapp:wamid.1")).toBe("done");
  });

  it.each([
    ["missing", null],
    ["forged", "attacker-secret-0123456789"]
  ])("%s signature → 403 with no side effects", async (_l, secret) => {
    expect((await whatsappPOST(waRequest(waBody("wamid.x"), secret), ctx())).status).toBe(403);
    expectRejectedWithoutSideEffects();
  });

  it("503 when the integration has no app_secret (META_APP_SECRET is not used for a manual connect)", async () => {
    process.env.META_APP_SECRET = "platform-secret-0123456789";
    h.integrations.set("whatsapp", integration("whatsapp", { phone_number_id: "PN-1", access_token: "EAAtoken" }));
    const res = await whatsappPOST(waRequest(waBody("wamid.2"), "platform-secret-0123456789"), ctx());
    expect(res.status).toBe(503);
    expect(h.db.claimCalls()).toBe(0);
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "inbound_rejected", result: { reason: "no_app_secret" } }));
  });

  it("an OAuth-connected integration (platform app) is verified with META_APP_SECRET", async () => {
    process.env.META_APP_SECRET = "platform-secret-0123456789";
    h.integrations.set(
      "whatsapp",
      integration("whatsapp", { phone_number_id: "PN-1", access_token: "EAAtoken" }, { connected_via: "oauth" })
    );
    expect((await whatsappPOST(waRequest(waBody("wamid.3"), "platform-secret-0123456789"), ctx())).status).toBe(200);
  });

  it("a replay is a duplicate and gets no second reply", async () => {
    await whatsappPOST(waRequest(waBody("wamid.4"), WA_SECRET), ctx());
    await drain();
    const again = await whatsappPOST(waRequest(waBody("wamid.4"), WA_SECRET), ctx());
    expect(await again.json()).toMatchObject({ accepted: 0, duplicates: 1 });
    await drain();
    expect(handleMock).toHaveBeenCalledTimes(1);
  });

  it("ignores other numbers on the same app, media without text and stale messages", async () => {
    const stale = Math.floor(Date.now() / 1000) - 30 * 3600;
    for (const body of [waBody("wamid.5", { phoneNumberId: "PN-OTHER" }), waBody("wamid.6", { text: null }), waBody("wamid.7", { ts: stale })]) {
      const res = await whatsappPOST(waRequest(body, WA_SECRET), ctx());
      expect((await res.json()).accepted).toBe(0);
    }
    expect(h.db.claimCalls()).toBe(0);
  });

  it("413 for an oversized body", async () => {
    const raw = `{"pad":"${"x".repeat(1_000_100)}"}`;
    const res = await whatsappPOST(rawPost(WA_URL, raw, { "x-hub-signature-256": signMetaPayload(raw, WA_SECRET) }), ctx());
    expect(res.status).toBe(413);
  });

  it("GET handshake: integration token, constant-time; refused without an integration", async () => {
    const get = (token: string) =>
      whatsappGET(new NextRequest(`${WA_URL}?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=987`), ctx());
    const ok = await get("wa-verify-1");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("987");
    expect((await get("nope")).status).toBe(403);
    process.env.WHATSAPP_VERIFY_TOKEN = "env-token";
    h.integrations.clear();
    expect((await get("env-token")).status).toBe(403);
  });
});

// ─── Slack ─────────────────────────────────────────────────────────────────

const SLACK_SECRET = "slack-signing-secret-0123";
const SLACK_URL = `https://arabclue.test/api/employees/webhooks/slack/${EMPLOYEE_ID}`;
function slackRequest(payload: unknown, secret: string | null, opts: { ts?: number; retry?: string } = {}) {
  const raw = JSON.stringify(payload);
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = { "content-type": "application/json", "x-slack-request-timestamp": ts };
  if (secret) headers["x-slack-signature"] = `v0=${createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex")}`;
  if (opts.retry) headers["x-slack-retry-num"] = opts.retry;
  return rawPost(SLACK_URL, raw, headers);
}
const slackEvent = (eventId: string, text = "مرحبا يا فريق") => ({
  type: "event_callback",
  event_id: eventId,
  event: { type: "message", channel: "C123", user: "U456", text }
});

describe("Slack webhook (F04)", () => {
  beforeEach(() => {
    h.integrations.set("slack", integration("slack", { bot_token: "xoxb-1", signing_secret: SLACK_SECRET }));
  });

  it("keeps the url_verification handshake working (signed)", async () => {
    const res = await slackPOST(slackRequest({ type: "url_verification", challenge: "ch-123" }, SLACK_SECRET), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: "ch-123" });
  });

  it("acks at once and replies in after(), to the channel id", async () => {
    const res = await slackPOST(slackRequest(slackEvent("Ev1"), SLACK_SECRET), ctx());
    expect(res.status).toBe(200);
    expect(handleMock).not.toHaveBeenCalled();
    await drain();
    expect(handleMock).toHaveBeenCalledWith({
      employeeId: EMPLOYEE_ID,
      channel: "slack",
      externalId: "C123",
      text: "مرحبا يا فريق",
      contactName: "U456"
    });
  });

  it("a Slack retry of a processed event_id is acknowledged without a second reply", async () => {
    await slackPOST(slackRequest(slackEvent("Ev2"), SLACK_SECRET), ctx());
    await drain();
    const retry = await slackPOST(slackRequest(slackEvent("Ev2"), SLACK_SECRET, { retry: "1" }), ctx());
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ duplicates: 1 });
    await drain();
    expect(handleMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing", null, undefined],
    ["forged", "wrong-secret", undefined],
    ["stale (replayed after 5 min)", SLACK_SECRET, Math.floor(Date.now() / 1000) - 600]
  ])("%s signature → 403 with no side effects", async (_l, secret, ts) => {
    expect((await slackPOST(slackRequest(slackEvent("Ev3"), secret, { ts }), ctx())).status).toBe(403);
    expectRejectedWithoutSideEffects();
  });

  it("503 when neither the integration nor SLACK_SIGNING_SECRET has a secret; env secret works for OAuth installs", async () => {
    h.integrations.set("slack", integration("slack", { bot_token: "xoxb-1" }, { connected_via: "oauth" }));
    expect((await slackPOST(slackRequest(slackEvent("Ev4"), SLACK_SECRET), ctx())).status).toBe(503);
    expectRejectedWithoutSideEffects();
    process.env.SLACK_SIGNING_SECRET = "platform-slack-secret";
    expect((await slackPOST(slackRequest(slackEvent("Ev4"), "platform-slack-secret"), ctx())).status).toBe(200);
  });

  it("413 for an oversized body", async () => {
    const res = await slackPOST(slackRequest({ type: "event_callback", pad: "x".repeat(1_000_100) }, SLACK_SECRET), ctx());
    expect(res.status).toBe(413);
  });
});

// ─── Telegram ──────────────────────────────────────────────────────────────

const TG_SECRET = "a".repeat(64);
const TG_URL = `https://arabclue.test/api/employees/webhooks/telegram/${EMPLOYEE_ID}`;
const tgUpdate = (updateId: number, text = "مرحبا") => ({
  update_id: updateId,
  message: { message_id: 7, date: Math.floor(Date.now() / 1000), chat: { id: 4242, first_name: "Ali" }, from: { id: 4242, first_name: "Ali" }, text }
});
const tgRequest = (payload: unknown, secret: string | null) =>
  rawPost(TG_URL, JSON.stringify(payload), secret ? { "x-telegram-bot-api-secret-token": secret } : {});

describe("Telegram webhook (F29)", () => {
  beforeEach(() => {
    h.integrations.set("telegram", integration("telegram", { bot_token: "123:abc", webhook_secret: TG_SECRET }));
  });

  it("processes an update with the right secret once", async () => {
    expect((await telegramPOST(tgRequest(tgUpdate(1), TG_SECRET), ctx())).status).toBe(200);
    await drain();
    expect(handleMock).toHaveBeenCalledWith({ employeeId: EMPLOYEE_ID, channel: "telegram", externalId: "4242", text: "مرحبا", contactName: "Ali" });
    const replay = await telegramPOST(tgRequest(tgUpdate(1), TG_SECRET), ctx());
    expect(await replay.json()).toMatchObject({ duplicates: 1 });
    await drain();
    expect(handleMock).toHaveBeenCalledTimes(1);
    expect(h.db.claims.get(`telegram:${EMPLOYEE_ID}:1`)).toBe("done");
  });

  it.each([
    ["missing", null],
    ["wrong", "b".repeat(64)],
    ["prefix of the real one", TG_SECRET.slice(0, 32)]
  ])("%s secret header → 403 with no side effects", async (_l, secret) => {
    expect((await telegramPOST(tgRequest(tgUpdate(2), secret), ctx())).status).toBe(403);
    expectRejectedWithoutSideEffects();
  });

  it("refuses everything (503) when no secret is stored — the old code skipped the check", async () => {
    h.integrations.set("telegram", integration("telegram", { bot_token: "123:abc" }));
    expect((await telegramPOST(tgRequest(tgUpdate(3), null), ctx())).status).toBe(503);
    expectRejectedWithoutSideEffects();
  });

  it("413 for an oversized body", async () => {
    const res = await telegramPOST(rawPost(TG_URL, `{"pad":"${"x".repeat(1_000_100)}"}`, { "x-telegram-bot-api-secret-token": TG_SECRET }), ctx());
    expect(res.status).toBe(413);
  });
});

// ─── Twilio SMS ────────────────────────────────────────────────────────────

const AUTH_TOKEN = "twilio-auth-token-0123456789";
const SMS_PATH = `/api/employees/webhooks/sms/${EMPLOYEE_ID}`;
function twilioSignature(url: string, params: Record<string, string>, token = AUTH_TOKEN) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
}
function smsRequest(params: Record<string, string>, signature: string | null, internalUrl = `http://10.0.0.5:3000${SMS_PATH}`) {
  return rawPost(internalUrl, new URLSearchParams(params).toString(), {
    "content-type": "application/x-www-form-urlencoded",
    "x-forwarded-host": "arabclue.test",
    "x-forwarded-proto": "https",
    ...(signature ? { "x-twilio-signature": signature } : {})
  });
}
const smsParams = (sid: string) => ({ MessageSid: sid, From: "+966512345678", To: "+15005550006", Body: "هل الطلب جاهز؟" });

describe("Twilio SMS webhook", () => {
  beforeEach(() => {
    h.integrations.set("twilio_sms", integration("twilio_sms", { account_sid: "AC1", auth_token: AUTH_TOKEN, from: "+15005550006" }));
  });

  it("verifies against the public URL behind a proxy, replies in after(), answers empty TwiML", async () => {
    const params = smsParams("SM1");
    const res = await smsPOST(smsRequest(params, twilioSignature(`https://arabclue.test${SMS_PATH}`, params)), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    await drain();
    expect(handleMock).toHaveBeenCalledWith({ employeeId: EMPLOYEE_ID, channel: "twilio_sms", externalId: "+966512345678", text: "هل الطلب جاهز؟" });
  });

  it("accepts the URL registered from NEXT_PUBLIC_SITE_URL", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.arabclue.test";
    const params = smsParams("SM2");
    const res = await smsPOST(smsRequest(params, twilioSignature(`https://app.arabclue.test${SMS_PATH}`, params)), ctx());
    expect(res.status).toBe(200);
  });

  it("a replayed MessageSid gets no second reply", async () => {
    const params = smsParams("SM3");
    const sig = twilioSignature(`https://arabclue.test${SMS_PATH}`, params);
    await smsPOST(smsRequest(params, sig), ctx());
    await drain();
    await smsPOST(smsRequest(params, sig), ctx());
    await drain();
    expect(handleMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing", null],
    ["forged", "c2lnbmF0dXJl"],
    ["signed for another URL", twilioSignature("https://evil.test/hook", smsParams("SM4"))]
  ])("%s signature → 403 with no side effects", async (_l, sig) => {
    expect((await smsPOST(smsRequest(smsParams("SM4"), sig), ctx())).status).toBe(403);
    expectRejectedWithoutSideEffects();
  });

  it("503 when the integration has no auth token", async () => {
    h.integrations.set("twilio_sms", integration("twilio_sms", { account_sid: "AC1" }));
    expect((await smsPOST(smsRequest(smsParams("SM5"), "x"), ctx())).status).toBe(503);
    expectRejectedWithoutSideEffects();
  });

  it("413 for an oversized form", async () => {
    const res = await smsPOST(smsRequest({ Body: "x".repeat(70_000) }, "x"), ctx());
    expect(res.status).toBe(413);
  });
});
