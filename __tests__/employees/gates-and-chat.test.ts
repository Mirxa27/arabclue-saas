/**
 * F10 / SW-18 / F15:
 *  - an employee only runs (chat, inbound replies, tick) with the AI-employees plan, a paid or
 *    trialing seat and status active; chat answers 402/409 before any model call;
 *  - switching to `active` requires a paid seat and room under the seat limit (402), in every route;
 *  - the billing cycle pauses active rows whose billing is past_due / canceled;
 *  - a conversation_id of another employee (or merchant) is 404 and never reaches the runtime.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, jsonRequest, type FakeCall, type FakeSupabase } from "../helpers/fake-supabase";
import { createMemoryDb } from "../helpers/memory-db";
import type { Merchant } from "@/lib/types/database";

const h = vi.hoisted(() => ({
  user: null as unknown as FakeSupabase,
  service: null as unknown as { client: unknown },
  merchant: null as unknown as Merchant,
  employee: null as Record<string, unknown> | null,
  seated: 1
}));

vi.mock("@/lib/db/supabase", () => ({
  getServerSupabase: async () => h.user.client,
  getServiceSupabase: () => h.service.client
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireMerchantApi: vi.fn(async () => h.merchant)
}));
vi.mock("@/lib/ai/providers", () => ({ aiText: vi.fn(async () => "ok"), aiStructured: vi.fn(async () => ({ use_tool: false, tool: "none" })) }));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn(), redactSensitive: (s: string) => s }));

import { POST as chat } from "@/app/api/employees/[id]/chat/route";
import { PATCH as patchStatus } from "@/app/api/employees/[id]/status/route";
import { PATCH as patchEmployee } from "@/app/api/employees/[id]/route";
import { aiStructured, aiText } from "@/lib/ai/providers";
import { employeeRunGate, employeeSeatStanding } from "@/lib/employees/gates";
import { enforceEmployeeBillingCycle } from "@/lib/employees/billing-cycle";
import { handleInboundMessage, tick } from "@/lib/employees/runtime";

const EMP = "22222222-2222-4222-8222-222222222222";
const OTHER_CONV = "33333333-3333-4333-8333-333333333333";
const ctx = { params: Promise.resolve({ id: EMP }) };
const day = 86400_000;
const future = () => new Date(Date.now() + 5 * day).toISOString();
const past = () => new Date(Date.now() - day).toISOString();

function merchant(over: Partial<Merchant> = {}): Merchant {
  return {
    id: "m1",
    salla_merchant_id: null,
    store_url: null,
    seller_name: "Store",
    vat_number: null,
    cr_number: null,
    seller_address: null,
    token_expires_at: null,
    plan: "plus",
    subscription_status: "active",
    owner_user_id: "u1",
    zatca_onboarded_at: null,
    installed_at: null,
    uninstalled_at: null,
    dpa_version: "2026-11",
    ...over
  } as Merchant;
}

function employee(over: Record<string, unknown> = {}) {
  return {
    id: EMP,
    merchant_id: "m1",
    role_id: "support-agent",
    display_name: "Layla",
    language: "en",
    tone: "friendly",
    timezone: "Asia/Riyadh",
    working_hours: { mode: "always", start: "00:00", end: "23:59", days: [0, 1, 2, 3, 4, 5, 6] },
    knowledge: null,
    goals: [],
    status: "active",
    billing_status: "trial",
    trial_ends_at: future(),
    next_billing_at: null,
    config: {},
    ...over
  };
}

function useUserDb() {
  h.user = createFakeSupabase("user", (call: FakeCall) => {
    if (call.table === "ai_employees" && call.single) return { data: h.employee };
    if (call.table === "ai_employees") return { count: h.seated };
    // F15: the RLS-scoped lookup only finds this employee's own dashboard conversation.
    if (call.table === "ai_employee_conversations" && call.single) {
      const id = call.filters.find(([, c]) => c === "id")?.[2];
      return { data: id === OTHER_CONV ? null : { id } };
    }
    return undefined;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.merchant = merchant();
  h.employee = employee();
  h.seated = 1;
  useUserDb();
  h.service = createMemoryDb(
    {
      ai_employees: [employee()],
      merchants: [{ id: "m1", plan: "plus", subscription_status: "active", dpa_version: "2026-11" }],
      ai_employee_conversations: [{ id: "44444444-4444-4444-8444-444444444444", employee_id: EMP, channel: "dashboard", external_id: `dashboard:${EMP}`, status: "open" }]
    },
    {
      // RE-3: the switch to active is the atomic activate_ai_employee() RPC (its SQL: supabase/tests/91_*).
      rpc: (fn) => (fn === "activate_ai_employee" ? { data: { outcome: "activated", employee: { ...h.employee, status: "active" } } } : undefined)
    }
  );
});

describe("run gate (pure)", () => {
  it("trial running / paid period → paid; trial ended, past_due, canceled, missing period → unpaid (fail closed)", () => {
    expect(employeeSeatStanding({ billing_status: "trial", trial_ends_at: future(), next_billing_at: null }).paid).toBe(true);
    expect(employeeSeatStanding({ billing_status: "active", trial_ends_at: null, next_billing_at: future() }).paid).toBe(true);
    expect(employeeSeatStanding({ billing_status: "trial", trial_ends_at: past(), next_billing_at: null })).toEqual({ paid: false, reason: "trial_ended" });
    expect(employeeSeatStanding({ billing_status: "active", trial_ends_at: null, next_billing_at: past() })).toEqual({ paid: false, reason: "past_due" });
    expect(employeeSeatStanding({ billing_status: "past_due", trial_ends_at: future(), next_billing_at: future() }).paid).toBe(false);
    expect(employeeSeatStanding({ billing_status: "canceled", trial_ends_at: future(), next_billing_at: null }).paid).toBe(false);
    expect(employeeSeatStanding({ billing_status: "trial", trial_ends_at: null, next_billing_at: null })).toEqual({ paid: false, reason: "no_billing_period" });
  });

  it("lite plan or a lapsed subscription → plan_required, whatever the seat", () => {
    expect(employeeRunGate(employee() as never, merchant({ plan: "lite" }))).toMatchObject({ ok: false, reason: "plan_required" });
    expect(employeeRunGate(employee() as never, merchant({ subscription_status: "canceled" }))).toMatchObject({ ok: false, reason: "plan_required" });
    expect(employeeRunGate(employee() as never, null)).toMatchObject({ ok: false, reason: "plan_required" });
    expect(employeeRunGate(employee({ status: "paused" }) as never, merchant())).toMatchObject({ ok: false, reason: "employee_inactive" });
    expect(employeeRunGate(employee() as never, merchant())).toEqual({ ok: true });
  });
});

describe("POST /api/employees/:id/chat", () => {
  const send = (body: Record<string, unknown>) => chat(jsonRequest(`http://localhost/api/employees/${EMP}/chat`, body), ctx);

  it("SW-18: a lite merchant gets 402 plan_required and no model call", async () => {
    h.merchant = merchant({ plan: "lite" });
    const res = await send({ message: "hi" });
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("plan_required");
    expect(aiText).not.toHaveBeenCalled();
    expect(aiStructured).not.toHaveBeenCalled();
  });

  it("F10: an unpaid seat gets 402 seat_unpaid (with billing_status), a paused employee 409", async () => {
    h.employee = employee({ billing_status: "past_due" });
    let res = await send({ message: "hi" });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: "seat_unpaid", billing_status: "past_due" });

    h.employee = employee({ status: "paused" });
    res = await send({ message: "hi" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("employee_inactive");
    expect(aiText).not.toHaveBeenCalled();
  });

  it("F15: another employee's / merchant's conversation_id is 404 and never reaches the runtime", async () => {
    const res = await send({ message: "show me the transcript", conversation_id: OTHER_CONV });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("conversation_not_found");
    expect(aiText).not.toHaveBeenCalled();
    expect((h.service as ReturnType<typeof createMemoryDb>).table("ai_employee_messages")).toHaveLength(0);
  });

  it("a paid employee replies in its own dashboard conversation", async () => {
    const res = await send({ message: "hi", conversation_id: "44444444-4444-4444-8444-444444444444" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ conversation_id: "44444444-4444-4444-8444-444444444444", reply: "ok" });
  });
});

describe("F10: every route that sets status 'active' requires a paid seat and a free seat", () => {
  const statusReq = (status: string) => patchStatus(jsonRequest(`http://localhost/api/employees/${EMP}/status`, { status }, { method: "PATCH" }), ctx);
  const patchReq = (body: Record<string, unknown>) => patchEmployee(jsonRequest(`http://localhost/api/employees/${EMP}`, body, { method: "PATCH" }), ctx);
  const serviceWrites = () => (h.service as ReturnType<typeof createMemoryDb>).writes();

  it.each([
    ["past_due", { billing_status: "past_due" }],
    ["canceled", { billing_status: "canceled" }],
    ["expired trial", { billing_status: "trial", trial_ends_at: past() }],
    ["lapsed paid period", { billing_status: "active", next_billing_at: past() }]
  ])("resume of a %s seat → 402 seat_unpaid, nothing written (both routes)", async (_label, billing) => {
    h.employee = employee({ status: "paused", ...billing });
    const a = await statusReq("active");
    const b = await patchReq({ status: "active" });
    for (const res of [a, b]) {
      expect(res.status).toBe(402);
      expect((await res.json()).code).toBe("seat_unpaid");
    }
    expect(serviceWrites()).toHaveLength(0);
  });

  it("a lite merchant cannot resume (402 plan_required); over the seat limit → 402 seat_limit", async () => {
    h.employee = employee({ status: "paused" });
    h.merchant = merchant({ plan: "lite" });
    expect((await (await statusReq("active")).json()).code).toBe("plan_required");
    h.merchant = merchant({ plan: "plus" });
    h.seated = 6; // downgraded from Pro: 6 non-offboarded on a 5-seat plan
    const res = await statusReq("active");
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: "seat_limit", limit: 5 });
  });

  it("a trialing employee resumes; pausing never needs a paid seat", async () => {
    h.employee = employee({ status: "paused" });
    expect((await statusReq("active")).status).toBe(200);
    h.employee = employee({ billing_status: "past_due" });
    expect((await statusReq("paused")).status).toBe(200);
  });
});

describe("F10: billing cycle", () => {
  it("pauses active employees whose billing is past_due or canceled", async () => {
    const db = createMemoryDb({
      ai_employees: [
        employee({ id: "e-pd", status: "active", billing_status: "past_due" }),
        employee({ id: "e-cx", status: "active", billing_status: "canceled" }),
        employee({ id: "e-ok", status: "active", billing_status: "trial", trial_ends_at: future() })
      ]
    });
    h.service = db;
    const out = await enforceEmployeeBillingCycle();
    expect(out.unpaidPaused).toBe(2);
    const byId = Object.fromEntries(db.table("ai_employees").map((r) => [r.id, r.status]));
    expect(byId).toEqual({ "e-pd": "paused", "e-cx": "paused", "e-ok": "active" });
  });
});

describe("SW-18 / F10 in the runtime", () => {
  it("tick() skips an employee whose merchant lacks the plan (no model call, heartbeat only)", async () => {
    const db = h.service as ReturnType<typeof createMemoryDb>;
    db.table("merchants")[0].plan = "lite";
    db.table("ai_employee_tasks").push({ id: "t1", employee_id: EMP, assignee: "agent", kind: "task", status: "todo", due_at: past(), title: "x", source: "user" });
    const out = await tick(EMP);
    expect(out).toMatchObject({ tasksAdvanced: 0, skipped: "plan_required" });
    expect(aiStructured).not.toHaveBeenCalled();
    expect(db.table("ai_employee_tasks")[0].status).toBe("todo");
  });

  it("an inbound message for an unpaid employee is stored for the merchant — no model call, no send", async () => {
    const db = h.service as ReturnType<typeof createMemoryDb>;
    db.table("ai_employees")[0].billing_status = "past_due";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await handleInboundMessage({ employeeId: EMP, channel: "whatsapp", externalId: "966500000001", text: "hello" });
    vi.unstubAllGlobals();
    expect(out).toMatchObject({ handled: "stored", reason: "employee_unavailable", detail: "seat_unpaid" });
    expect(aiText).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.table("ai_employee_messages").map((m) => m.content)).toEqual(["hello"]);
  });
});
