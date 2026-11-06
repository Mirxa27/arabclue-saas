/**
 * RE-4: a message the employee sends on the merchant's behalf belongs to the recipient's own
 * conversation. A follow-up scheduled from the dashboard stores that conversation, is not sent
 * while a human has taken it over, and its text is saved there — never in the dashboard thread.
 * The real runtime, router, tools, tick, dispatch and WhatsApp adapter run; the model, Supabase
 * (in-memory) and fetch are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, type Row } from "../helpers/memory-db";

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("../helpers/memory-db").createMemoryDb>,
  decision: { use_tool: false, tool: "none" } as Record<string, unknown>
}));

vi.mock("@/lib/db/supabase", () => ({ getServiceSupabase: () => h.db.client }));
vi.mock("@/lib/ai/providers", () => ({
  aiText: vi.fn(async () => "Done — I'll remind them."),
  aiStructured: vi.fn(async () => h.decision)
}));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn(), redactSensitive: (s: string) => s }));

import { respond, tick } from "@/lib/employees/runtime";
import { aiText } from "@/lib/ai/providers";

const EMP = "77777777-7777-4777-8777-777777777701";
const DASH = "77777777-7777-4777-8777-777777777702";
const CUST = "77777777-7777-4777-8777-777777777703";
const CUSTOMER = "966501112222";
const BODY = "Your order ships today";

const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
  String(input).includes("graph.facebook.com")
    ? new Response(JSON.stringify({ messages: [{ id: "wamid.F" }] }), { status: 200 })
    : new Response("{}", { status: 404 })
);
const graphSends = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("graph.facebook.com"));

function seed(conversations: Row[] = []) {
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
    ai_employee_conversations: [
      { id: DASH, employee_id: EMP, channel: "dashboard", external_id: `dashboard:${EMP}`, status: "open", unread_count: 0 },
      ...conversations
    ]
  });
}

const customerThread = (over: Row = {}): Row => ({
  id: CUST,
  employee_id: EMP,
  channel: "whatsapp",
  external_id: CUSTOMER,
  status: "open",
  unread_count: 0,
  ...over
});

/** The merchant asks, in the dashboard chat, for a follow-up to the customer. */
async function scheduleFromDashboard(to = CUSTOMER) {
  h.decision = { use_tool: true, tool: "schedule_followup", channel: "whatsapp", to, body: BODY, followup_in_minutes: 5 };
  await respond({ employeeId: EMP, conversationId: DASH, userMessage: `remind ${to} in 5 minutes that the order ships today`, origin: "merchant" });
  const task = h.db.table("ai_employee_tasks").find((t) => t.kind === "followup") as Row;
  task.due_at = new Date(Date.now() - 60_000).toISOString(); // make it due
  return task;
}

const messagesIn = (conversationId: string) =>
  h.db.table("ai_employee_messages").filter((m) => m.conversation_id === conversationId).map((m) => String(m.content));

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("RE-4: dashboard-scheduled follow-ups live in the recipient's conversation", () => {
  it("stores the customer's conversation on the task and saves the sent text there, not in the dashboard thread", async () => {
    seed([customerThread()]);
    const task = await scheduleFromDashboard();
    expect(task.conversation_id).toBe(CUST);

    const out = await tick(EMP);
    expect(out.tasksAdvanced).toBe(1);
    expect(graphSends()).toHaveLength(1);
    expect(JSON.parse(String(graphSends()[0][1]?.body))).toMatchObject({ to: CUSTOMER, text: { body: BODY } });
    expect(messagesIn(CUST)).toEqual([BODY]);
    expect(messagesIn(DASH).filter((c) => c === BODY)).toHaveLength(0);
    expect(h.db.table("ai_employee_tasks").find((t) => t.id === task.id)).toMatchObject({ status: "done", conversation_id: CUST });

    // The next dashboard turn's transcript does not contain the customer's message as "You: …".
    h.decision = { use_tool: false, tool: "none" };
    vi.mocked(aiText).mockClear();
    await respond({ employeeId: EMP, conversationId: DASH, userMessage: "thanks", origin: "merchant" });
    expect(String(vi.mocked(aiText).mock.calls[0][0].prompt)).not.toContain(`You: ${BODY}`);
  });

  it("a recipient the employee never talked to gets a conversation of their own", async () => {
    seed();
    const task = await scheduleFromDashboard("966507770000");
    const created = h.db.table("ai_employee_conversations").find((c) => c.id === task.conversation_id) as Row;
    expect(created).toMatchObject({ employee_id: EMP, channel: "whatsapp", external_id: "966507770000", status: "open" });

    await tick(EMP);
    expect(graphSends()).toHaveLength(1);
    expect(messagesIn(String(created.id))).toEqual([BODY]);
    expect(messagesIn(DASH).filter((c) => c === BODY)).toHaveLength(0);
  });

  it("is handed to the merchant, not sent, when the customer's thread was taken over in the meantime", async () => {
    seed([customerThread()]);
    const task = await scheduleFromDashboard();
    (h.db.table("ai_employee_conversations").find((c) => c.id === CUST) as Row).status = "escalated";

    const out = await tick(EMP);
    expect(out).toMatchObject({ tasksAdvanced: 0, handedOver: 1 });
    expect(graphSends()).toHaveLength(0);
    expect(h.db.table("ai_employee_tasks").find((t) => t.id === task.id)).toMatchObject({ status: "blocked", assignee: "human", conversation_id: CUST });
    expect(messagesIn(CUST)).toEqual([]);
  });

  it("tells the merchant at scheduling time when the thread is with the team", async () => {
    seed([customerThread({ status: "escalated" })]);
    await scheduleFromDashboard();
    expect(String(vi.mocked(aiText).mock.calls[0][0].prompt)).toMatch(/human takeover/);
  });

  it("a follow-up scheduled before this fix (pointing at the dashboard thread) is routed to the customer's thread at send time", async () => {
    seed([customerThread({ status: "escalated" })]);
    h.db.table("ai_employee_tasks").push({
      id: "legacy-1",
      employee_id: EMP,
      title: "Follow up on whatsapp",
      description: BODY,
      source: "autonomous",
      priority: "normal",
      status: "todo",
      due_at: new Date(Date.now() - 60_000).toISOString(),
      result: null,
      assignee: "agent",
      kind: "followup",
      conversation_id: DASH,
      payload: { origin: "merchant", action: "send_message", channel: "whatsapp", to: CUSTOMER, body: BODY }
    });
    const out = await tick(EMP);
    // The customer's thread is in human takeover: handed over, not sent into it.
    expect(out).toMatchObject({ tasksAdvanced: 0, handedOver: 1 });
    expect(graphSends()).toHaveLength(0);
    expect(h.db.table("ai_employee_tasks").find((t) => t.id === "legacy-1")).toMatchObject({ conversation_id: CUST });
  });
});

describe("RE-4: an immediate send from the dashboard is kept in the recipient's conversation", () => {
  it("send_message saves the text in the customer's thread", async () => {
    seed([customerThread()]);
    h.decision = { use_tool: true, tool: "send_message", channel: "whatsapp", to: CUSTOMER, body: BODY };
    await respond({ employeeId: EMP, conversationId: DASH, userMessage: `tell ${CUSTOMER} the order ships today`, origin: "merchant" });
    expect(graphSends()).toHaveLength(1);
    expect(messagesIn(CUST)).toEqual([BODY]);
    const tool = h.db.table("ai_employee_messages").find((m) => m.role === "tool") as Row;
    expect(JSON.parse(String(tool.content))).toMatchObject({ ok: true, output: { conversation_id: CUST } });
  });
});
