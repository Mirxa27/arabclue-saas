/**
 * SW-5: the 24/7 tick only marks a task done after a real action succeeded; escalations,
 * invoice drafts and customer requests stay with the merchant; nothing is "completed" with a
 * model-written paragraph. Real runtime + tools + dispatch + adapters; model, DB and fetch faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, type Row } from "../helpers/memory-db";

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("../helpers/memory-db").createMemoryDb>,
  decision: { use_tool: false, tool: "none" } as Record<string, unknown>,
  graphStatus: 200
}));

vi.mock("@/lib/db/supabase", () => ({ getServiceSupabase: () => h.db.client }));
vi.mock("@/lib/ai/providers", () => ({
  aiText: vi.fn(async () => "I have completed the task."),
  aiStructured: vi.fn(async () => h.decision)
}));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn(), redactSensitive: (s: string) => s }));

import { tick } from "@/lib/employees/runtime";
import { aiText } from "@/lib/ai/providers";

const EMP = "55555555-5555-4555-8555-555555555555";
const CONV = "66666666-6666-4666-8666-666666666666";
const CUSTOMER = "966501112222";
const past = new Date(Date.now() - 3600_000).toISOString();

const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
  if (String(input).includes("graph.facebook.com")) {
    return h.graphStatus === 200
      ? new Response(JSON.stringify({ messages: [{ id: "wamid.T" }] }), { status: 200 })
      : new Response(JSON.stringify({ error: { message: "Recipient not available" } }), { status: h.graphStatus });
  }
  return new Response("{}", { status: 404 });
});
const graphSends = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("graph.facebook.com"));

function task(over: Row): Row {
  return {
    employee_id: EMP,
    title: "task",
    description: null,
    source: "autonomous",
    priority: "normal",
    status: "todo",
    due_at: past,
    result: null,
    assignee: "agent",
    kind: "task",
    payload: { origin: "merchant" },
    conversation_id: null,
    ...over
  };
}

function seed(tasks: Row[]) {
  h.db = createMemoryDb({
    ai_employees: [
      {
        id: EMP,
        merchant_id: "m1",
        role_id: "support-agent",
        display_name: "Noura",
        language: "en",
        tone: "friendly",
        timezone: "Asia/Riyadh",
        working_hours: { mode: "always", start: "00:00", end: "23:59", days: [0, 1, 2, 3, 4, 5, 6] },
        knowledge: null,
        goals: [],
        status: "active",
        billing_status: "active",
        trial_ends_at: null,
        next_billing_at: new Date(Date.now() + 20 * 86400_000).toISOString(),
        config: {}
      }
    ],
    merchants: [{ id: "m1", plan: "pro", subscription_status: "active", dpa_version: "2026-11" }],
    ai_employee_integrations: [
      { id: "i-wa", employee_id: EMP, kind: "whatsapp", status: "connected", config: {}, credentials: { phone_number_id: "1066", access_token: "wa-token" } }
    ],
    ai_employee_conversations: [{ id: CONV, employee_id: EMP, channel: "whatsapp", external_id: CUSTOMER, status: "open", unread_count: 0 }],
    ai_employee_tasks: tasks
  });
}

const byTitle = (title: string) => h.db.table("ai_employee_tasks").find((t) => t.title === title) as Row;
const actions = (action: string) => h.db.table("ai_employee_actions").filter((a) => a.action === action);

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  h.decision = { use_tool: false, tool: "none" };
  h.graphStatus = 200;
});
afterEach(() => vi.unstubAllGlobals());

describe("tick(): merchant-owned work is never auto-completed", () => {
  it("escalations, invoice drafts and approvals are not picked up; their data survives", async () => {
    seed([
      task({ title: "Escalation: chargeback", assignee: "human", kind: "escalation", priority: "urgent" }),
      task({ title: "Issue ZATCA invoice (1150 SAR)", assignee: "human", kind: "invoice_draft", result: { amount: 1150, buyer_phone: "+966500000001" } }),
      task({ title: "Customer request awaiting your approval", assignee: "human", kind: "approval" })
    ]);
    const out = await tick(EMP);
    expect(out.tasksAdvanced).toBe(0);
    for (const t of h.db.table("ai_employee_tasks")) expect(t.status).toBe("todo");
    expect(byTitle("Issue ZATCA invoice (1150 SAR)").result).toEqual({ amount: 1150, buyer_phone: "+966500000001" });
    expect(aiText).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(actions("complete_task")).toHaveLength(0);
  });

  it("an escalation that reached the agent's queue anyway is handed back — never 'done'", async () => {
    seed([task({ title: "Escalate to human: legal threat", kind: "escalation", priority: "urgent" })]);
    const out = await tick(EMP);
    expect(out).toMatchObject({ tasksAdvanced: 0, handedOver: 1 });
    expect(byTitle("Escalate to human: legal threat")).toMatchObject({ status: "todo", assignee: "human" });
    expect(actions("task_handed_over")[0]).toMatchObject({ status: "retry" });
    expect(actions("complete_task")).toHaveLength(0);
  });
});

describe("tick(): follow-ups", () => {
  const followup = (over: Row = {}) =>
    task({
      title: "Follow up on whatsapp",
      kind: "followup",
      conversation_id: CONV,
      payload: { origin: "inbound_channel", action: "send_message", channel: "whatsapp", to: CUSTOMER, body: "Your order is on its way" },
      ...over
    });

  it("is sent exactly once, then marked done with the send recorded", async () => {
    seed([followup()]);
    expect((await tick(EMP)).tasksAdvanced).toBe(1);
    expect(graphSends()).toHaveLength(1);
    expect(JSON.parse(String(graphSends()[0][1]?.body))).toMatchObject({ to: CUSTOMER, text: { body: "Your order is on its way" } });
    const t = byTitle("Follow up on whatsapp");
    expect(t.status).toBe("done");
    expect((t.result as { sent: Record<string, unknown> }).sent).toMatchObject({ channel: "whatsapp", to: CUSTOMER, remote_id: "wamid.T" });
    expect(h.db.table("ai_employee_messages").map((m) => m.content)).toEqual(["Your order is on its way"]);

    await tick(EMP);
    expect(graphSends()).toHaveLength(1);
  });

  it("a failed send leaves the task blocked with the error — no success logged", async () => {
    h.graphStatus = 400;
    seed([followup()]);
    const out = await tick(EMP);
    expect(out).toMatchObject({ tasksAdvanced: 0, blocked: 1 });
    const t = byTitle("Follow up on whatsapp");
    expect(t.status).toBe("blocked");
    expect(String((t.result as { error: string }).error)).toMatch(/send failed/);
    expect(actions("complete_task").every((a) => a.status !== "success")).toBe(true);
  });

  it("a customer follow-up whose recipient is not its conversation's contact is blocked without sending", async () => {
    seed([followup({ payload: { origin: "inbound_channel", action: "send_message", channel: "whatsapp", to: "15550009999", body: "x" } })]);
    await tick(EMP);
    expect(graphSends()).toHaveLength(0);
    expect(byTitle("Follow up on whatsapp").status).toBe("blocked");
  });
});

describe("tick(): free-form agent tasks", () => {
  it("a merchant task completes only through a real action (send to the number the merchant wrote)", async () => {
    seed([task({ title: "WhatsApp 966500000777 that the order shipped", source: "user" })]);
    h.decision = { use_tool: true, tool: "send_message", channel: "whatsapp", to: "966500000777", body: "Your order shipped" };
    expect((await tick(EMP)).tasksAdvanced).toBe(1);
    expect(graphSends()).toHaveLength(1);
    expect(byTitle("WhatsApp 966500000777 that the order shipped")).toMatchObject({ status: "done" });
    expect(actions("complete_task")[0]).toMatchObject({ status: "success" });
  });

  it("no concrete action → handed to the merchant with the reason, logged as retry (not success)", async () => {
    seed([task({ title: "Write three captions for the new abaya line", source: "user" })]);
    h.decision = { use_tool: false, tool: "none", reasoning: "Needs the owner's product photos" };
    const out = await tick(EMP);
    expect(out).toMatchObject({ tasksAdvanced: 0, handedOver: 1 });
    const t = byTitle("Write three captions for the new abaya line");
    expect(t).toMatchObject({ status: "todo", assignee: "human" });
    expect(String((t.result as { note: string }).note)).toContain("Needs the owner's product photos");
    expect(actions("complete_task")).toHaveLength(0);
    expect(aiText).not.toHaveBeenCalled();
  });

  it("a task the model wrote cannot introduce a new recipient (only existing contacts)", async () => {
    seed([task({ title: "Message 966500000888 about the promo", source: "autonomous" })]);
    h.decision = { use_tool: true, tool: "send_message", channel: "whatsapp", to: "966500000888", body: "promo" };
    await tick(EMP);
    expect(graphSends()).toHaveLength(0);
    expect(byTitle("Message 966500000888 about the promo").status).toBe("blocked");
  });
});
