/**
 * Employee runtime inbound path:
 *  - upsertConversation survives the unique-index race between two deliveries (23505).
 *  - critic-17(h): escalated / snoozed / closed conversations store the message but get
 *    no AI turn and no channel send (human takeover).
 *  - critic-16: a Meta send failure that breaks the channel flags the integration.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeCall, type FakeResult, type FakeSupabase } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({ sb: null as unknown as FakeSupabase }));

vi.mock("@/lib/db/supabase", () => ({ getServiceSupabase: () => h.sb.client }));
vi.mock("@/lib/ai/providers", () => ({ aiText: vi.fn(async () => "أهلاً! كيف أقدر أساعدك؟") }));
vi.mock("@/lib/employees/tools", () => ({
  decideTool: vi.fn(async () => ({ use_tool: false, tool: "none" })),
  executeTool: vi.fn()
}));
vi.mock("@/lib/employees/channels/dispatch", () => ({ dispatchChannelSend: vi.fn(async () => ({ remoteId: "mid.out" })) }));
vi.mock("@/lib/employees/integration-store", () => ({ markIntegrationError: vi.fn(async () => true) }));

import { handleInboundMessage, HUMAN_TAKEOVER_STATUSES, upsertConversation } from "@/lib/employees/runtime";
import { aiText } from "@/lib/ai/providers";
import { dispatchChannelSend } from "@/lib/employees/channels/dispatch";
import { markIntegrationError } from "@/lib/employees/integration-store";
import { GraphApiError } from "@/lib/meta/graph";

const EMP = "66666666-6666-4666-8666-666666666666";
const conversation = (status: string, unread = 2) => ({
  id: "conv-1",
  employee_id: EMP,
  channel: "meta",
  external_id: "PSID-1",
  status,
  unread_count: unread
});
const employee = {
  id: EMP,
  merchant_id: "m1",
  role_id: "support",
  display_name: "نورة",
  language: "ar",
  tone: "friendly",
  timezone: "Asia/Riyadh",
  working_hours: { mode: "always", start: "00:00", end: "23:59", days: [0, 1, 2, 3, 4, 5, 6] },
  knowledge: null,
  goals: [],
  status: "active",
  config: {}
};

function useDb(opts: { conv?: ReturnType<typeof conversation> | null; insertConv?: FakeResult; raced?: ReturnType<typeof conversation> } = {}) {
  let convSelects = 0;
  h.sb = createFakeSupabase("service", (call: FakeCall) => {
    if (call.table === "ai_employee_conversations" && call.op === "select" && call.single === "maybeSingle") {
      convSelects += 1;
      return { data: convSelects === 1 ? opts.conv ?? null : opts.raced ?? null };
    }
    if (call.table === "ai_employee_conversations" && call.op === "insert") {
      return opts.insertConv ?? { data: conversation("open", 0) };
    }
    if (call.table === "ai_employee_conversations" && call.op === "select") return { data: conversation("open") };
    if (call.table === "ai_employees") return { data: employee };
    if (call.table === "ai_employee_integrations") {
      return { data: [{ id: "int-meta", kind: "meta", status: "connected", credentials: { page_id: "1", page_access_token: "t" }, config: {} }] };
    }
    if (call.table === "ai_employee_messages" && call.op === "insert") return { data: { id: "msg-1" } };
    if (call.table === "ai_employee_messages") return { data: [] };
    return undefined;
  });
}

const inbound = (over: Partial<Parameters<typeof handleInboundMessage>[0]> = {}) =>
  handleInboundMessage({ employeeId: EMP, channel: "meta", externalId: "PSID-1", text: "عندي سؤال", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  useDb();
});

describe("upsertConversation", () => {
  it("returns the row the concurrent delivery created when the insert hits 23505", async () => {
    useDb({ conv: null, insertConv: { error: { code: "23505", message: "duplicate key value" } }, raced: conversation("open") });
    const conv = await upsertConversation({ employeeId: EMP, channel: "meta", externalId: "PSID-1" });
    expect(conv.id).toBe("conv-1");
    const selects = h.sb.calls.filter((c) => c.table === "ai_employee_conversations" && c.op === "select");
    expect(selects).toHaveLength(2);
  });

  it("still throws other insert errors", async () => {
    useDb({ conv: null, insertConv: { error: { code: "23503", message: "fk violation" } } });
    await expect(upsertConversation({ employeeId: EMP, channel: "meta", externalId: "PSID-1" })).rejects.toThrow(/fk violation/);
  });
});

describe("handleInboundMessage — human takeover (critic-17h)", () => {
  it.each([...HUMAN_TAKEOVER_STATUSES])("%s: stores the message, bumps unread, no AI turn and no send", async (status) => {
    useDb({ conv: conversation(status, 2) });
    const out = await inbound();
    expect(out).toEqual({ handled: "stored", conversationId: "conv-1", reason: "human_takeover" });

    const messageInserts = h.sb.calls.filter((c) => c.table === "ai_employee_messages" && c.op === "insert");
    expect(messageInserts).toHaveLength(1);
    expect(messageInserts[0].payload).toMatchObject({ conversation_id: "conv-1", role: "user", content: "عندي سؤال" });
    expect(
      h.sb.calls.some((c) => c.table === "ai_employee_conversations" && c.op === "update" && (c.payload as { unread_count?: number }).unread_count === 3)
    ).toBe(true);
    expect(h.sb.calls.find((c) => c.table === "ai_employee_actions")?.payload).toMatchObject({
      action: "inbound_stored",
      result: { reason: "human_takeover", conversationId: "conv-1" }
    });
    expect(aiText).not.toHaveBeenCalled();
    expect(dispatchChannelSend).not.toHaveBeenCalled();
  });

  it("storeOnly (integration in error) also skips the AI and the send", async () => {
    useDb({ conv: conversation("open") });
    expect(await inbound({ storeOnly: "integration_error" })).toMatchObject({ handled: "stored", reason: "integration_error" });
    expect(aiText).not.toHaveBeenCalled();
    expect(dispatchChannelSend).not.toHaveBeenCalled();
  });

  it("an open conversation gets the AI reply sent to the sender", async () => {
    useDb({ conv: conversation("open") });
    const out = await inbound();
    expect(out).toMatchObject({ handled: "replied", conversationId: "conv-1", reply: "أهلاً! كيف أقدر أساعدك؟", delivered: true });
    expect(vi.mocked(dispatchChannelSend).mock.calls[0][0]).toMatchObject({ kind: "meta", to: "PSID-1", body: "أهلاً! كيف أقدر أساعدك؟" });
  });
});

describe("handleInboundMessage — send failures (critic-16)", () => {
  it("an expired Page token flags the integration status='error' with the mapped reason", async () => {
    useDb({ conv: conversation("open") });
    vi.mocked(dispatchChannelSend).mockRejectedValueOnce(
      new GraphApiError("Messenger send failed", 401, { message: "Error validating access token", code: 190, error_subcode: 463 })
    );
    const out = await inbound();
    expect(out).toMatchObject({ handled: "replied", delivered: false });
    expect(markIntegrationError).toHaveBeenCalledWith(
      EMP,
      "meta",
      expect.objectContaining({ reason: "token_invalid", source: "send", graph_code: 190, graph_subcode: 463 })
    );
    const failure = h.sb.calls.find((c) => c.table === "ai_employee_actions" && (c.payload as { action?: string }).action === "send_message");
    expect(failure?.payload).toMatchObject({ status: "failure", result: { reason: "token_invalid", scope: "integration" } });
  });

  it("a per-customer failure (outside the 24 h window) is logged but does not flag the integration", async () => {
    useDb({ conv: conversation("open") });
    vi.mocked(dispatchChannelSend).mockRejectedValueOnce(
      new GraphApiError("Messenger send failed", 400, { message: "outside window", code: 10, error_subcode: 2018278 })
    );
    await inbound();
    expect(markIntegrationError).not.toHaveBeenCalled();
  });

  it("non-Meta channels are not classified", async () => {
    useDb({ conv: { ...conversation("open"), channel: "telegram" } });
    vi.mocked(dispatchChannelSend).mockRejectedValueOnce(new Error("Telegram send failed: Forbidden"));
    await inbound({ channel: "telegram" });
    expect(markIntegrationError).not.toHaveBeenCalled();
  });
});
