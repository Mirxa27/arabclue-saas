/**
 * F06: /api/meta/webhook (platform app, social handover) is signed with META_APP_SECRET,
 * picks the platform from body.object, dedupes per event, and never reaches the AI
 * employee runtime. Regression guard: a signed comments change still reaches
 * processSocialInbound.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signMetaPayload } from "@/lib/webhooks/meta-signature";
import { createClaimDb, rawPost, runAfterTasks, type AfterTask, type ClaimDb } from "../helpers/webhook-fakes";

const h = vi.hoisted(() => ({
  db: null as unknown as ClaimDb,
  channels: new Map<string, string>(), // `${platform}:${external_id}` → merchant_id
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
vi.mock("@/lib/social/handover", () => ({
  processSocialInbound: vi.fn(async () => ({ decision: { action: "reply", reply: "x" } }))
}));
vi.mock("@/lib/employees/runtime", () => ({
  handleInboundMessage: vi.fn(),
  logAction: vi.fn(),
  respond: vi.fn()
}));
vi.mock("@/lib/observability/error-reporter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/observability/error-reporter")>();
  return { ...actual, reportError: vi.fn() };
});

import { GET, POST } from "@/app/api/meta/webhook/route";
import { processSocialInbound } from "@/lib/social/handover";
import { handleInboundMessage } from "@/lib/employees/runtime";

const SECRET = "platform-meta-app-secret-01234";
const IG = "17841400000000077";
const MERCHANT = "44444444-4444-4444-8444-444444444444";
const URL = "https://arabclue.test/api/meta/webhook";
const processMock = vi.mocked(processSocialInbound);
const drain = () => runAfterTasks(h.afterTasks as AfterTask[]);

const escapeUnicode = (s: string) => s.replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
function signed(payload: unknown, secret: string | null = SECRET) {
  const raw = escapeUnicode(JSON.stringify(payload));
  return rawPost(URL, raw, { "content-type": "application/json", ...(secret ? { "x-hub-signature-256": signMetaPayload(raw, secret) } : {}) });
}
const comment = (id: string, text = "بكم هذا؟", from: { id: string; username?: string } = { id: "IGSID-5", username: "sara.k" }) => ({
  object: "instagram",
  entry: [{ id: IG, time: Date.now(), changes: [{ field: "comments", value: { id, text, from, media: { id: "M1" } } }] }]
});

beforeEach(() => {
  vi.clearAllMocks();
  h.afterTasks.length = 0;
  h.channels = new Map([[`instagram:${IG}`, MERCHANT], ["whatsapp:PN-9", MERCHANT]]);
  h.db = createClaimDb((call) => {
    if (call.table !== "social_channels") return undefined;
    const platform = call.filters.find(([, c]) => c === "platform")?.[2];
    const externalId = call.filters.find(([, c]) => c === "external_id")?.[2];
    const merchant = h.channels.get(`${String(platform)}:${String(externalId)}`);
    return { data: merchant ? { merchant_id: merchant } : null };
  });
  process.env.META_APP_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.META_APP_SECRET;
  delete process.env.META_WEBHOOK_VERIFY_TOKEN;
});

describe("POST /api/meta/webhook", () => {
  it("regression: a signed comments change still reaches processSocialInbound (after the ack)", async () => {
    const res = await POST(signed(comment("C-1")));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, accepted: 1, duplicates: 0 });
    expect(processMock).not.toHaveBeenCalled();
    await drain();
    expect(processMock).toHaveBeenCalledTimes(1);
    expect(processMock.mock.calls[0][1]).toEqual({
      merchantId: MERCHANT,
      platform: "instagram",
      kind: "comment",
      from: "sara.k",
      text: "بكم هذا؟"
    });
    expect(h.db.claims.get("meta_social:instagram_comment:C-1")).toBe("done");
  });

  it("a redelivered comment is a duplicate", async () => {
    await POST(signed(comment("C-2")));
    await drain();
    const again = await POST(signed(comment("C-2")));
    expect(await again.json()).toMatchObject({ accepted: 0, duplicates: 1 });
    await drain();
    expect(processMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["unsigned", null],
    ["forged", "not-the-platform-secret-xxxx"]
  ])("%s deliveries → 403 before parsing: no lookup, no claim, no engager call", async (_l, secret) => {
    const res = await POST(signed(comment("C-3"), secret));
    expect(res.status).toBe(403);
    expect(h.db.calls).toEqual([]);
    expect(h.db.claimCalls()).toBe(0);
    expect(processMock).not.toHaveBeenCalled();
  });

  it("503 when META_APP_SECRET is unset (no unauthenticated mode)", async () => {
    delete process.env.META_APP_SECRET;
    const res = await POST(signed(comment("C-4"), "anything-at-all-0123"));
    expect(res.status).toBe(503);
    expect(h.db.calls).toEqual([]);
  });

  it("Instagram DMs are routed as platform instagram (not 'whatsapp'), echoes dropped, never to the employee runtime", async () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: IG,
          time: Date.now(),
          messaging: [
            { sender: { id: "IGSID-8" }, recipient: { id: IG }, timestamp: Date.now(), message: { mid: "ig-mid-1", text: "مرحبا" } },
            { sender: { id: IG }, recipient: { id: "IGSID-8" }, timestamp: Date.now(), message: { mid: "ig-mid-2", text: "أهلا", is_echo: true } }
          ]
        }
      ]
    };
    const res = await POST(signed(payload));
    expect(await res.json()).toMatchObject({ accepted: 1, skipped: { echo: 1 } });
    await drain();
    expect(processMock.mock.calls[0][1]).toMatchObject({ platform: "instagram", kind: "dm", from: "IGSID-8", text: "مرحبا" });
    expect(handleInboundMessage).not.toHaveBeenCalled();
  });

  it("DMs for unknown accounts are not processed", async () => {
    h.channels.clear();
    const payload = {
      object: "instagram",
      entry: [{ id: "999", messaging: [{ sender: { id: "S" }, recipient: { id: "999" }, timestamp: Date.now(), message: { mid: "x", text: "hi" } }] }]
    };
    const res = await POST(signed(payload));
    expect(await res.json()).toMatchObject({ accepted: 0, skipped: { unknown_account: 1 } });
    expect(h.db.claimCalls()).toBe(0);
    expect(processMock).not.toHaveBeenCalled();
    expect(handleInboundMessage).not.toHaveBeenCalled();
  });

  it("WhatsApp messages are matched by phone_number_id", async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA-1",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "PN-9" },
                messages: [{ from: "966500000002", id: "wamid.P1", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "متى يوصل؟" } }]
              }
            }
          ]
        }
      ]
    };
    expect((await (await POST(signed(payload))).json()).accepted).toBe(1);
    await drain();
    expect(processMock.mock.calls[0][1]).toEqual({ merchantId: MERCHANT, platform: "whatsapp", kind: "dm", from: "966500000002", text: "متى يوصل؟" });
  });

  it("Messenger (object page) has no social channel: acknowledged and ignored", async () => {
    const payload = { object: "page", entry: [{ id: "1", messaging: [{ sender: { id: "P" }, recipient: { id: "1" }, message: { mid: "m", text: "hi" } }] }] };
    const res = await POST(signed(payload));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: 0, skipped: { unsupported_object: 1 } });
    expect(processMock).not.toHaveBeenCalled();
  });

  it("the business's own comments are not fed back to the engager", async () => {
    const res = await POST(signed(comment("C-own", "شكراً", { id: IG, username: "store" })));
    expect(await res.json()).toMatchObject({ accepted: 0, skipped: { self: 1 } });
  });

  it("400 for signed non-JSON; 413 for an oversized body", async () => {
    const raw = "oops";
    expect((await POST(rawPost(URL, raw, { "x-hub-signature-256": signMetaPayload(raw, SECRET) }))).status).toBe(400);
    const big = `{"pad":"${"x".repeat(1_000_100)}"}`;
    expect((await POST(rawPost(URL, big, { "x-hub-signature-256": signMetaPayload(big, SECRET) }))).status).toBe(413);
  });
});

describe("GET /api/meta/webhook handshake", () => {
  it("echoes the challenge only for META_WEBHOOK_VERIFY_TOKEN", async () => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = "platform-verify-token";
    const ok = await GET(new NextRequest(`${URL}?hub.mode=subscribe&hub.verify_token=platform-verify-token&hub.challenge=55`));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("55");
    const bad = await GET(new NextRequest(`${URL}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=55`));
    expect(bad.status).toBe(403);
  });
});
