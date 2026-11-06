/**
 * GET/POST /api/employees/webhooks/meta/[id] — Messenger + Instagram DMs for one employee.
 * Proves: fail-closed signature binding, the hub handshake, filtering, `${kind}:${mid}`
 * claims (replay → duplicate), ack-before-LLM via after(), partial claim failure → 500.
 */
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { DecryptedIntegration } from "@/lib/employees/integration-store";
import { signMetaPayload } from "@/lib/webhooks/meta-signature";
import { createClaimDb, EMPLOYEE_ID, OTHER_EMPLOYEE_ID, rawPost, runAfterTasks, type AfterTask, type ClaimDb } from "../helpers/webhook-fakes";

const h = vi.hoisted(() => ({
  db: null as unknown as ClaimDb,
  integrations: [] as DecryptedIntegration[],
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
  loadEmployeeIntegrations: vi.fn(async (employeeId: string, kinds: readonly string[], opts?: { statuses?: readonly string[] }) =>
    h.integrations.filter(
      (i) => i.employee_id === employeeId && kinds.includes(i.kind) && (opts?.statuses ?? ["connected"]).includes(i.status)
    )
  ),
  loadEmployeeIntegration: vi.fn(async () => null),
  touchIntegrationLastEvent: vi.fn(async () => undefined),
  markIntegrationError: vi.fn(async () => true)
}));
vi.mock("@/lib/employees/runtime", () => ({
  handleInboundMessage: vi.fn(async () => ({ handled: "replied", conversationId: "c1", reply: "ok", messageId: "m", latencyMs: 1, delivered: true })),
  logAction: vi.fn(async () => undefined)
}));
vi.mock("@/lib/observability/error-reporter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/observability/error-reporter")>();
  return { ...actual, reportError: vi.fn() };
});

import { GET, POST } from "@/app/api/employees/webhooks/meta/[id]/route";
import { handleInboundMessage, logAction } from "@/lib/employees/runtime";
import { touchIntegrationLastEvent } from "@/lib/employees/integration-store";

const PAGE = "104000000000001";
const IG = "17841400000000001";
const META_SECRET = "meta-app-secret-0123456789abcdef";
const IG_SECRET = "insta-app-secret-0123456789abcdef";
/** META_APP_SECRET — the platform app's secret, set in every production deployment. */
const PLATFORM_SECRET = "operator-app-secret-0123456789";
const UNSAVED_SECRET = "a-secret-nobody-saved-0123456789";
const VERIFY = "merchant-verify-token-123";
const URL_BASE = `https://arabclue.test/api/employees/webhooks/meta/${EMPLOYEE_ID}`;
const ctx = (id = EMPLOYEE_ID) => ({ params: Promise.resolve({ id }) });
const handleMock = vi.mocked(handleInboundMessage);

function row(kind: "meta" | "instagram", credentials: Record<string, unknown>, over: Partial<DecryptedIntegration> = {}): DecryptedIntegration {
  return {
    id: `int-${kind}`,
    employee_id: EMPLOYEE_ID,
    kind,
    external_id: kind === "meta" ? PAGE : IG,
    config: {},
    status: "connected",
    last_event_at: null,
    created_at: "2026-11-01T00:00:00Z",
    credentials,
    ...over
  };
}
const metaRow = (creds: Record<string, unknown> = {}, over: Partial<DecryptedIntegration> = {}) =>
  row("meta", { page_id: PAGE, page_access_token: "PAT", app_secret: META_SECRET, verify_token: VERIFY, ...creds }, over);
const igRow = (creds: Record<string, unknown> = {}, over: Partial<DecryptedIntegration> = {}) =>
  row("instagram", { page_id: PAGE, page_access_token: "PAT", ig_account_id: IG, app_secret: IG_SECRET, verify_token: VERIFY, ...creds }, over);
/** The row the employee OAuth flow writes for Instagram content publishing (lib/employees/oauth/flow.ts). */
const oauthIgRow = (over: Partial<DecryptedIntegration> = {}) =>
  row(
    "instagram",
    { access_token: "EAAuser-publishing-token", scope: "instagram_basic,instagram_content_publish", expires_in: 5183944 },
    { external_id: null, config: { connected_via: "oauth" }, ...over }
  );
/** logInboundRejected is throttled per employee, channel and reason — tests asserting a note use their own employee. */
const freshEmployee = () => randomUUID();

/** Meta sends non-ASCII as \u escapes — sign and send exactly those bytes. */
const escapeUnicode = (s: string) => s.replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

function signed(payload: unknown, secret: string | null, opts: { id?: string } = {}): NextRequest {
  const raw = typeof payload === "string" ? payload : escapeUnicode(JSON.stringify(payload));
  return rawPost(`https://arabclue.test/api/employees/webhooks/meta/${opts.id ?? EMPLOYEE_ID}`, raw, {
    "content-type": "application/json",
    ...(secret ? { "x-hub-signature-256": signMetaPayload(raw, secret) } : {})
  });
}

const NOW = Date.now();
const dm = (mid: string, over: { sender?: string; recipient?: string; text?: string; timestamp?: number } = {}, message: Record<string, unknown> = {}) => ({
  sender: { id: over.sender ?? "PSID-1" },
  recipient: { id: over.recipient ?? PAGE },
  timestamp: over.timestamp ?? NOW - 5_000,
  message: { mid, text: over.text ?? "مرحبا", ...message }
});
const pageBody = (...messaging: unknown[]) => ({ object: "page", entry: [{ id: PAGE, time: NOW, messaging }] });
const igBody = (...messaging: unknown[]) => ({ object: "instagram", entry: [{ id: IG, time: NOW, messaging }] });

const replied = { handled: "replied", conversationId: "c1", reply: "ok", messageId: "m", latencyMs: 1, delivered: true } as const;

beforeEach(() => {
  h.db = createClaimDb();
  h.integrations = [metaRow(), igRow()];
  h.afterTasks.length = 0;
  vi.clearAllMocks();
  handleMock.mockReset();
  handleMock.mockResolvedValue(replied);
});
afterEach(() => {
  delete process.env.META_APP_SECRET;
  delete process.env.META_WEBHOOK_VERIFY_TOKEN;
});

const drain = () => runAfterTasks(h.afterTasks as AfterTask[]);

describe("GET handshake", () => {
  const verify = (token: string, id = EMPLOYEE_ID, challenge = "1158201444") =>
    GET(new NextRequest(`https://arabclue.test/api/employees/webhooks/meta/${id}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=${challenge}`), ctx(id));

  it("echoes the challenge as text/plain for the integration's verify token", async () => {
    const res = await verify(VERIFY);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("1158201444");
  });

  it("refuses a mismatching token", async () => {
    expect((await verify("wrong-token-wrong-token")).status).toBe(403);
  });

  it("falls back to META_WEBHOOK_VERIFY_TOKEN only for an integration without its own token", async () => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = "platform-verify-token-1";
    h.integrations = [metaRow({ verify_token: undefined })];
    expect((await verify("platform-verify-token-1")).status).toBe(200);
  });

  it("refuses when the employee has no Meta integration, even with the env token", async () => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = "platform-verify-token-1";
    expect((await verify("platform-verify-token-1", OTHER_EMPLOYEE_ID)).status).toBe(403);
    expect((await verify(VERIFY, "not-a-uuid")).status).toBe(403);
  });
});

describe("POST authentication (fail closed)", () => {
  it("404s with nothing claimed when the employee has no Meta integration", async () => {
    const res = await POST(signed(pageBody(dm("m_1")), META_SECRET, { id: OTHER_EMPLOYEE_ID }), ctx(OTHER_EMPLOYEE_ID));
    expect(res.status).toBe(404);
    expect(h.db.claimCalls()).toBe(0);
  });

  it.each([
    ["missing", null],
    ["forged", "some-other-secret-0123456789"]
  ])("%s signature → 403, no claim, no DB write, no AI call", async (_label, secret) => {
    const res = await POST(signed(pageBody(dm("m_1")), secret), ctx());
    expect(res.status).toBe(403);
    expect(h.db.claimCalls()).toBe(0);
    expect(h.db.writes()).toEqual([]);
    expect(h.afterTasks).toHaveLength(0);
    expect(handleMock).not.toHaveBeenCalled();
    // At most the throttled refusal note (RB-W1) — never an inbound_message / reply.
    for (const [entry] of vi.mocked(logAction).mock.calls) {
      expect(entry).toMatchObject({ action: "inbound_rejected", result: { reason: "signature_mismatch" } });
    }
    if (secret === null) expect(logAction).not.toHaveBeenCalled();
  });

  it("503 when no app secret is configured anywhere, and the refusal is logged", async () => {
    h.integrations = [metaRow({ app_secret: undefined })];
    const res = await POST(signed(pageBody(dm("m_1")), META_SECRET), ctx());
    expect(res.status).toBe(503);
    expect(h.db.claimCalls()).toBe(0);
    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: EMPLOYEE_ID, action: "inbound_rejected", channel: "meta", result: { reason: "no_app_secret" } })
    );
  });

  it("accepts META_APP_SECRET for a row whose Page token was proven at connect to belong to the platform app", async () => {
    process.env.META_APP_SECRET = PLATFORM_SECRET;
    h.integrations = [metaRow({ app_secret: undefined }, { config: { connected_via: "platform" } })];
    const res = await POST(signed(pageBody(dm("m_env")), PLATFORM_SECRET), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, accepted: 1 });
  });

  it("binding: an Instagram event signed with the Messenger row's secret is refused", async () => {
    const res = await POST(signed(igBody(dm("m_ig", { recipient: IG, sender: "IGSID-1" })), META_SECRET), ctx());
    expect(res.status).toBe(403);
    expect(h.db.claimCalls()).toBe(0);
  });

  it("413 for an oversized body before any lookup", async () => {
    const raw = `{"object":"page","pad":"${"x".repeat(1_000_100)}"}`;
    const res = await POST(rawPost(URL_BASE, raw, { "x-hub-signature-256": signMetaPayload(raw, META_SECRET) }), ctx());
    expect(res.status).toBe(413);
    expect(h.db.claimCalls()).toBe(0);
  });

  it("400 for a validly signed non-JSON body", async () => {
    const res = await POST(signed("not json", META_SECRET), ctx());
    expect(res.status).toBe(400);
  });
});

describe("POST happy path", () => {
  it("acknowledges a signed Arabic Messenger DM, then replies to the PSID in after()", async () => {
    handleMock.mockImplementationOnce(() => new Promise(() => undefined)); // the LLM never answers
    const res = await POST(signed(pageBody(dm("m_1")), META_SECRET), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, accepted: 1, duplicates: 0, skipped: {} });
    expect(JSON.stringify(body)).not.toContain("مرحبا"); // counts only (PDPL)
    expect(handleMock).not.toHaveBeenCalled(); // ack came before the AI turn
    expect(h.afterTasks).toHaveLength(1);
    expect(h.db.claims.get("meta_messaging:meta:m_1")).toBe("processing");

    void h.afterTasks[0]();
    await vi.waitFor(() => expect(handleMock).toHaveBeenCalledTimes(1));
    expect(handleMock).toHaveBeenCalledWith({ employeeId: EMPLOYEE_ID, channel: "meta", externalId: "PSID-1", text: "مرحبا" });
  });

  it("completes the claim and records last_event_at once processed", async () => {
    await POST(signed(pageBody(dm("m_2")), META_SECRET), ctx());
    await drain();
    expect(h.db.claims.get("meta_messaging:meta:m_2")).toBe("done");
    expect(touchIntegrationLastEvent).toHaveBeenCalledWith(["int-meta"]);
  });

  it("routes object instagram to the instagram row: channel instagram, IGSID recipient", async () => {
    const res = await POST(signed(igBody(dm("m_ig_1", { recipient: IG, sender: "IGSID-9", text: "كم السعر؟" })), IG_SECRET), ctx());
    expect(res.status).toBe(200);
    await drain();
    expect(handleMock).toHaveBeenCalledWith({ employeeId: EMPLOYEE_ID, channel: "instagram", externalId: "IGSID-9", text: "كم السعر؟" });
    expect(h.db.claims.get("meta_messaging:instagram:m_ig_1")).toBe("done");
  });

  it("stores DMs without an AI reply while the integration is flagged error", async () => {
    h.integrations = [metaRow({}, { status: "error" })];
    await POST(signed(pageBody(dm("m_err")), META_SECRET), ctx());
    await drain();
    expect(handleMock).toHaveBeenCalledWith(expect.objectContaining({ channel: "meta", storeOnly: "integration_error" }));
  });

  it("processes a batch oldest first", async () => {
    const res = await POST(
      signed(
        pageBody(
          dm("m_b", { timestamp: NOW - 1_000, sender: "P1", text: "الثانية" }),
          dm("m_a", { timestamp: NOW - 9_000, sender: "P1", text: "الأولى" })
        ),
        META_SECRET
      ),
      ctx()
    );
    expect((await res.json()).accepted).toBe(2);
    await drain();
    expect(handleMock.mock.calls.map((c) => (c[0] as { text: string }).text)).toEqual(["الأولى", "الثانية"]);
    expect(h.db.claims.get("meta_messaging:meta:m_a")).toBe("done");
  });
});

describe("POST idempotency", () => {
  it("a replayed delivery is a duplicate and gets no second reply", async () => {
    const payload = pageBody(dm("m_replay"));
    expect((await POST(signed(payload, META_SECRET), ctx())).status).toBe(200);
    await drain();
    const second = await POST(signed(payload, META_SECRET), ctx());
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true, accepted: 0, duplicates: 1 });
    await drain();
    expect(handleMock).toHaveBeenCalledTimes(1);
  });

  it("a delivery whose message is still being processed answers 409 (Meta retries later)", async () => {
    const payload = pageBody(dm("m_busy"));
    await POST(signed(payload, META_SECRET), ctx()); // claimed, after() not run yet
    const res = await POST(signed(payload, META_SECRET), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ in_progress: 1 });
  });

  it("a claim failure on the 2nd message → 500; the 1st is still processed; a redelivery handles only the 2nd", async () => {
    const opts: { failClaimsAfter?: number } = { failClaimsAfter: 1 };
    h.db = createClaimDb(undefined, opts);
    const payload = pageBody(dm("m_one", { sender: "A", timestamp: NOW - 2_000 }), dm("m_two", { sender: "B", timestamp: NOW - 1_000 }));

    const first = await POST(signed(payload, META_SECRET), ctx());
    expect(first.status).toBe(500);
    expect(h.afterTasks).toHaveLength(1);
    await drain();
    expect(handleMock).toHaveBeenCalledTimes(1);
    expect(handleMock.mock.calls[0][0]).toMatchObject({ externalId: "A" });

    opts.failClaimsAfter = undefined; // DB is back
    const retry = await POST(signed(payload, META_SECRET), ctx());
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ accepted: 1, duplicates: 1 });
    await drain();
    expect(handleMock).toHaveBeenCalledTimes(2);
    expect(handleMock.mock.calls[1][0]).toMatchObject({ externalId: "B" });
  });

  it("a failed AI turn releases the claim (status failed) and logs the failure", async () => {
    handleMock.mockRejectedValueOnce(new Error("Employee not found"));
    await POST(signed(pageBody(dm("m_fail")), META_SECRET), ctx());
    await drain();
    expect(h.db.claims.get("meta_messaging:meta:m_fail")).toBe("failed");
    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "inbound_message", channel: "meta", status: "failure", target: "PSID-1" })
    );
  });
});

describe("POST filtering", () => {
  it("echoes, receipts, reactions, attachment-only, stale and foreign-page events: 200, nothing claimed or answered", async () => {
    const base = { sender: { id: "PSID-1" }, recipient: { id: PAGE }, timestamp: NOW };
    const payload = {
      object: "page",
      entry: [
        {
          id: PAGE,
          messaging: [
            dm("m_echo", { sender: PAGE, recipient: "PSID-1" }, { is_echo: true }),
            { ...base, delivery: { mids: ["m_1"], watermark: NOW } },
            { ...base, read: { watermark: NOW } },
            { ...base, reaction: { mid: "m_1", action: "react", emoji: "👍" } },
            dm("m_img", { text: "" }, { text: undefined, attachments: [{ type: "image", payload: { url: "https://x.test/i.jpg" } }] }),
            dm("m_old", { timestamp: NOW - 30 * 3600 * 1000 })
          ]
        },
        { id: "999999", messaging: [dm("m_foreign", { recipient: "999999" })] }
      ]
    };
    const res = await POST(signed(payload, META_SECRET), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      accepted: 0,
      duplicates: 0,
      skipped: { echo: 1, non_message: 3, attachment_only: 1, stale: 1, foreign_account: 1 }
    });
    expect(h.db.claimCalls()).toBe(0);
    await drain();
    expect(handleMock).not.toHaveBeenCalled();
  });

  it("object page with only an Instagram row connected: 200 ignored kind_not_connected", async () => {
    h.integrations = [igRow()];
    const res = await POST(signed(pageBody(dm("m_1")), IG_SECRET), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: "kind_not_connected" });
  });

  it("other objects are acknowledged and ignored", async () => {
    const res = await POST(signed({ object: "whatsapp_business_account", entry: [] }, META_SECRET), ctx());
    expect(await res.json()).toEqual({ ok: true, ignored: "object" });
  });
});

describe("RB-W1: META_APP_SECRET only for platform-app rows; refused deliveries are visible", () => {
  const noteFor = (employeeId: string, channel: string, reason: string) =>
    expect.objectContaining({ employeeId, action: "inbound_rejected", channel, status: "failure", result: { reason } });

  it("a bring-your-own-app row without app_secret is never verified with META_APP_SECRET: 503, no_app_secret noted", async () => {
    process.env.META_APP_SECRET = PLATFORM_SECRET; // production
    const emp = freshEmployee();
    h.integrations = [metaRow({ app_secret: undefined }, { employee_id: emp, config: { connected_via: "manual" } })];
    // Signed by the merchant's own app (what Meta really sends here) or by the platform app: neither is accepted.
    for (const [i, secret] of ["merchant-own-app-secret-0123456789", PLATFORM_SECRET].entries()) {
      const res = await POST(signed(pageBody(dm(`m_byo_${i}`)), secret, { id: emp }), ctx(emp));
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: "webhook_not_configured" });
    }
    expect(h.db.claimCalls()).toBe(0);
    expect(handleMock).not.toHaveBeenCalled();
    expect(logAction).toHaveBeenCalledWith(noteFor(emp, "meta", "no_app_secret"));
  });

  it("a signature that matches no saved secret: 403 and a signature_mismatch note on the channel Meta delivered for", async () => {
    const emp = freshEmployee();
    h.integrations = [metaRow({}, { employee_id: emp }), igRow({}, { employee_id: emp })];
    const res = await POST(signed(igBody(dm("m_wrong", { recipient: IG, sender: "IGSID-1" })), UNSAVED_SECRET, { id: emp }), ctx(emp));
    expect(res.status).toBe(403);
    expect(h.db.claimCalls()).toBe(0);
    expect(h.afterTasks).toHaveLength(0);
    expect(logAction).toHaveBeenCalledTimes(1);
    expect(logAction).toHaveBeenCalledWith(noteFor(emp, "instagram", "signature_mismatch"));
  });

  it("the note is throttled: once per 10 minutes per employee, channel and reason", async () => {
    const emp = freshEmployee();
    h.integrations = [metaRow({}, { employee_id: emp })];
    for (let i = 0; i < 3; i++) {
      expect((await POST(signed(pageBody(dm(`m_t${i}`)), UNSAVED_SECRET, { id: emp }), ctx(emp))).status).toBe(403);
    }
    expect(logAction).toHaveBeenCalledTimes(1);
    expect(logAction).toHaveBeenCalledWith(noteFor(emp, "meta", "signature_mismatch"));
  });

  it("a delivery for a DM row with no secret of its own, unverifiable with the others' secrets: 403, no_app_secret noted", async () => {
    const emp = freshEmployee();
    h.integrations = [metaRow({}, { employee_id: emp }), igRow({ app_secret: undefined }, { employee_id: emp })];
    const res = await POST(signed(igBody(dm("m_ig_app", { recipient: IG })), "instagram-own-app-secret-0123456789", { id: emp }), ctx(emp));
    expect(res.status).toBe(403);
    expect(logAction).toHaveBeenCalledWith(noteFor(emp, "instagram", "no_app_secret"));
  });

  it("requests that do not look like a signed Meta delivery for a connected channel are refused without a note", async () => {
    const emp = freshEmployee();
    h.integrations = [metaRow({}, { employee_id: emp })];
    const url = `https://arabclue.test/api/employees/webhooks/meta/${emp}`;
    const pageRaw = JSON.stringify(pageBody(dm("m_x")));
    const requests = [
      rawPost(url, pageRaw), // no signature
      rawPost(url, pageRaw, { "x-hub-signature-256": "sha256=not-hex" }),
      rawPost(url, "not json", { "x-hub-signature-256": signMetaPayload("not json", UNSAVED_SECRET) }),
      signed({ object: "whatsapp_business_account", entry: [] }, UNSAVED_SECRET, { id: emp }),
      signed(igBody(dm("m_y", { recipient: IG })), UNSAVED_SECRET, { id: emp }) // Instagram is not connected here
    ];
    for (const req of requests) expect((await POST(req, ctx(emp))).status).toBe(403);
    expect(logAction).not.toHaveBeenCalled();
  });

  it("binding: an Instagram delivery signed with the Messenger row's secret is refused and noted for Instagram", async () => {
    const emp = freshEmployee();
    h.integrations = [metaRow({}, { employee_id: emp }), igRow({}, { employee_id: emp })];
    const res = await POST(signed(igBody(dm("m_bind", { recipient: IG, sender: "IGSID-1" })), META_SECRET, { id: emp }), ctx(emp));
    expect(res.status).toBe(403);
    expect(h.db.claimCalls()).toBe(0);
    expect(logAction).toHaveBeenCalledWith(noteFor(emp, "instagram", "signature_mismatch"));
  });

  it("an authenticated delivery whose channel's row has no secret of its own: 503, no_app_secret noted for that channel", async () => {
    const emp = freshEmployee();
    h.integrations = [metaRow({}, { employee_id: emp }), igRow({ app_secret: undefined }, { employee_id: emp })];
    // One app serves both channels (docs §7.2), so Instagram events carry the Messenger row's signature.
    const res = await POST(signed(igBody(dm("m_nosecret", { recipient: IG, sender: "IGSID-1" })), META_SECRET, { id: emp }), ctx(emp));
    expect(res.status).toBe(503);
    expect(h.db.claimCalls()).toBe(0);
    expect(logAction).toHaveBeenCalledWith(noteFor(emp, "instagram", "no_app_secret"));
  });
});

describe("RB-W2: only rows set up for DMs count", () => {
  it("Instagram connected only for publishing (OAuth row): an Instagram delivery verified by the Messenger app → 200 kind_not_connected", async () => {
    process.env.META_APP_SECRET = PLATFORM_SECRET; // production
    h.integrations = [metaRow(), oauthIgRow()];
    const res = await POST(signed(igBody(dm("m_ig_pub", { recipient: IG, sender: "IGSID-1" })), META_SECRET), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: "kind_not_connected" });
    expect(h.db.claimCalls()).toBe(0);
    expect(logAction).not.toHaveBeenCalled();
  });

  it("…the same answer as when no Instagram row exists at all", async () => {
    h.integrations = [metaRow()];
    const res = await POST(signed(igBody(dm("m_ig_none", { recipient: IG, sender: "IGSID-1" })), META_SECRET), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: "kind_not_connected" });
  });

  it("Messenger DMs keep working next to the publishing row", async () => {
    process.env.META_APP_SECRET = PLATFORM_SECRET;
    h.integrations = [metaRow(), oauthIgRow()];
    const res = await POST(signed(pageBody(dm("m_pg")), META_SECRET), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, accepted: 1 });
    await drain();
    expect(handleMock).toHaveBeenCalledWith(expect.objectContaining({ channel: "meta", externalId: "PSID-1" }));
  });

  it("the publishing row alone does not make the employee a Meta DM endpoint (handshake 403, deliveries 404)", async () => {
    process.env.META_APP_SECRET = PLATFORM_SECRET;
    process.env.META_WEBHOOK_VERIFY_TOKEN = "platform-verify-token-1";
    h.integrations = [oauthIgRow()];
    const handshake = await GET(
      new NextRequest(`${URL_BASE}?hub.mode=subscribe&hub.verify_token=platform-verify-token-1&hub.challenge=42`),
      ctx()
    );
    expect(handshake.status).toBe(403);
    const res = await POST(signed(igBody(dm("m_ig_only", { recipient: IG })), PLATFORM_SECRET), ctx());
    expect(res.status).toBe(404);
    expect(h.db.claimCalls()).toBe(0);
    expect(logAction).not.toHaveBeenCalled();
  });
});
