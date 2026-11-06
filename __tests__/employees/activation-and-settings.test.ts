/**
 * RE-3: resuming an employee takes its seat atomically — the routes call activate_ai_employee()
 * (seat check + switch in one transaction under the merchant lock), so concurrent resumes cannot
 * exceed the plan's limit. The service-role RPC is modelled on the in-memory tables here (its SQL
 * is tested in supabase/tests/91_* and the two-session race in 93_*).
 * RE-6: what the API accepts fits the database bounds, and a database refusal of the row (23514,
 * a character PostgreSQL cannot store) is a 400 invalid_employee_settings — never raw text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, jsonRequest, type FakeCall, type FakeResult, type FakeSupabase } from "../helpers/fake-supabase";
import { createMemoryDb, type Row } from "../helpers/memory-db";
import type { Merchant } from "@/lib/types/database";

const h = vi.hoisted(() => ({
  user: null as unknown as FakeSupabase,
  service: null as unknown as ReturnType<typeof import("../helpers/memory-db").createMemoryDb>,
  merchant: null as unknown as Merchant,
  rpcOverride: undefined as undefined | ((fn: string, args: Record<string, unknown>) => FakeResult | undefined),
  updateError: null as null | { code: string; message: string; details?: string },
  countError: null as null | { code: string; message: string }
}));

vi.mock("@/lib/db/supabase", () => ({
  getServerSupabase: async () => h.user.client,
  getServiceSupabase: () => h.service.client
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireMerchantApi: vi.fn(async () => h.merchant)
}));
vi.mock("@/lib/security/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/security/rate-limit")>()),
  enforceRateLimit: vi.fn(async () => ({ success: true, limit: 10, remaining: 9, resetAt: 0 }))
}));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn(), redactSensitive: (s: string) => s }));

import { POST as hire } from "@/app/api/employees/route";
import { PATCH as patchEmployee } from "@/app/api/employees/[id]/route";
import { PATCH as patchStatus } from "@/app/api/employees/[id]/status/route";
import { GOALS_MAX_JSON_BYTES, GoalsSchema } from "@/lib/employees/route-helpers";
import { HireSchema } from "@/lib/employees/hire";
import { EmployeeUpdateSchema } from "@/lib/employees/manage";

const M = "00000000-0000-4000-8000-00000000aa00";
const id = (n: number) => `00000000-0000-4000-8000-00000000aa${String(n).padStart(2, "0")}`;
const future = () => new Date(Date.now() + 5 * 86400_000).toISOString();

function employee(n: number, over: Row = {}): Row {
  return {
    id: id(n),
    merchant_id: M,
    role_id: "sales-rep",
    display_name: `E${n}`,
    status: "active",
    billing_status: "trial",
    trial_ends_at: future(),
    next_billing_at: null,
    paused_at: null,
    offboarded_at: null,
    knowledge: null,
    goals: [],
    config: {},
    ...over
  };
}

const PROFILE_KEYS = ["display_name", "avatar", "language", "tone", "timezone", "working_hours", "knowledge", "goals", "config"];

/** activate_ai_employee() on the in-memory rows (same outcomes as the SQL function). */
function activateModel(args: Record<string, unknown>): FakeResult {
  const rows = h.service.table("ai_employees");
  const emp = rows.find((e) => e.id === args.p_employee_id && e.merchant_id === args.p_merchant_id);
  if (!emp) return { data: { outcome: "employee_not_found" } };
  if (emp.status !== "active") {
    const paid =
      (emp.billing_status === "trial" && Date.parse(String(emp.trial_ends_at)) > Date.now()) ||
      (emp.billing_status === "active" && Date.parse(String(emp.next_billing_at)) > Date.now());
    if (!paid) return { data: { outcome: "seat_unpaid", billing_status: emp.billing_status, trial_ends_at: emp.trial_ends_at, next_billing_at: emp.next_billing_at } };
    const others = rows.filter((e) => e.merchant_id === args.p_merchant_id && e.status !== "offboarded" && e.id !== emp.id).length;
    if (others + 1 > Number(args.p_limit)) return { data: { outcome: "seat_limit", count: others } };
  }
  const patch = (args.p_patch ?? {}) as Row;
  for (const k of PROFILE_KEYS) if (k in patch) emp[k] = patch[k];
  Object.assign(emp, { status: "active", paused_at: null, offboarded_at: null });
  return { data: { outcome: "activated", employee: { ...emp } } };
}

function seed(rows: Row[]) {
  h.service = createMemoryDb(
    { ai_employees: rows },
    {
      override: (call: FakeCall) => (call.op === "update" && h.updateError ? { error: h.updateError } : undefined),
      rpc: (fn, args) => h.rpcOverride?.(fn, args) ?? (fn === "activate_ai_employee" ? activateModel(args) : undefined)
    }
  );
  // The owner's RLS-scoped session reads the same rows (ownership check and the seat count).
  h.user = createFakeSupabase("user", (call) => {
    if (call.table !== "ai_employees") return undefined;
    if (call.single) {
      const wanted = call.filters.find(([, c]) => c === "id")?.[2];
      const row = h.service.table("ai_employees").find((e) => e.id === wanted && e.merchant_id === M);
      return { data: row ? { ...row } : null };
    }
    if (h.countError) return { error: h.countError };
    return { count: h.service.table("ai_employees").filter((e) => e.merchant_id === M && e.status !== "offboarded").length };
  });
}

const seated = () => h.service.table("ai_employees").filter((e) => e.status !== "offboarded").length;
const ctx = (n: number) => ({ params: Promise.resolve({ id: id(n) }) });
const statusReq = (n: number, status: string) =>
  patchStatus(jsonRequest(`http://localhost/api/employees/${id(n)}/status`, { status }, { method: "PATCH" }), ctx(n));
const patchReq = (n: number, body: Record<string, unknown>) =>
  patchEmployee(jsonRequest(`http://localhost/api/employees/${id(n)}`, body, { method: "PATCH" }), ctx(n));
const hireReq = (body: Record<string, unknown>) => hire(jsonRequest("http://localhost/api/employees", body));

const RAW_DB_TEXT = /violates|constraint|Failing row|relation|secret-knowledge|ai_employees_/;

beforeEach(() => {
  vi.clearAllMocks();
  h.merchant = { id: M, plan: "plus", subscription_status: "active", seller_name: "Store", owner_user_id: "u1", dpa_version: "2026-11" } as Merchant;
  h.rpcOverride = undefined;
  h.updateError = null;
  h.countError = null;
});

describe("RE-3: resuming takes the seat atomically", () => {
  it("two concurrent resumes with one seat left: one activates, the other gets 402 seat_limit", async () => {
    // Plus plan: 5 seats. 4 seated + 2 offboarded whose trials still run.
    seed([1, 2, 3, 4].map((n) => employee(n)).concat([employee(5, { status: "offboarded" }), employee(6, { status: "offboarded" })]));
    const responses = await Promise.all([statusReq(5, "active"), statusReq(6, "active")]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 402]);
    const refused = responses.find((r) => r.status === 402) as Response;
    expect(await refused.json()).toMatchObject({ code: "seat_limit", limit: 5 });
    expect(seated()).toBe(5);
  });

  it("the switch goes through activate_ai_employee with the plan limit and the profile fields — never status", async () => {
    seed([employee(1), employee(2, { status: "paused" })]);
    const res = await patchReq(2, { status: "active", knowledge: "Opening hours 9-5", goals: ["reply fast"] });
    expect(res.status).toBe(200);
    expect((await res.json()).employee).toMatchObject({ id: id(2), status: "active", knowledge: "Opening hours 9-5" });
    const [rpc] = h.service.rpcCalls;
    expect(rpc).toMatchObject({
      fn: "activate_ai_employee",
      args: { p_merchant_id: M, p_employee_id: id(2), p_limit: 5, p_patch: { knowledge: "Opening hours 9-5", goals: ["reply fast"] } }
    });
    expect(rpc.args.p_patch).not.toHaveProperty("status");
    // No separate count-then-update write.
    expect(h.service.writes().filter((w) => w.table === "ai_employees")).toHaveLength(0);
  });

  it("the status route returns its projection of the activated row", async () => {
    seed([employee(1, { status: "paused", display_name: "Layla" })]);
    const res = await statusReq(1, "active");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: id(1), status: "active", display_name: "Layla", role_id: "sales-rep", message: "Layla is now active" });
  });

  it("the database's own seat check decides: seat_unpaid → 402 with the billing status", async () => {
    seed([employee(1, { status: "paused" })]);
    // e.g. the billing cycle paused the seat between the API's check and the switch
    h.rpcOverride = (fn) =>
      fn === "activate_ai_employee"
        ? { data: { outcome: "seat_unpaid", billing_status: "past_due", trial_ends_at: null, next_billing_at: null } }
        : undefined;
    const res = await statusReq(1, "active");
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: "seat_unpaid", billing_status: "past_due", seat: "past_due" });
  });

  it("pausing is a plain update (no seat check)", async () => {
    seed([employee(1)]);
    const res = await statusReq(1, "paused");
    expect(res.status).toBe(200);
    expect(h.service.rpcCalls).toHaveLength(0);
    expect(h.service.table("ai_employees")[0]).toMatchObject({ status: "paused" });
  });

  it("a failed seat count refuses with a stable message (no database text)", async () => {
    seed([employee(1, { status: "paused" })]);
    h.countError = { code: "57014", message: "canceling statement due to statement timeout on relation ai_employees" };
    const res = await statusReq(1, "active");
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/statement timeout|relation/);
    expect(h.service.rpcCalls).toHaveLength(0);
  });
});

describe("RE-6: API bounds fit the database bounds; refusals are 400 with a stable code", () => {
  const checkViolation = (constraint: string) => ({
    code: "23514",
    message: `new row for relation "ai_employees" violates check constraint "${constraint}"`,
    details: "Failing row contains (secret-knowledge, …)"
  });

  it("8 goals of 200 characters pass the API and fit ai_employees_goals_size even in the worst case", () => {
    const checkmarks = Array.from({ length: 8 }, () => "✓".repeat(200));
    const escaped = Array.from({ length: 8 }, () => "\u0001".repeat(200));
    for (const goals of [checkmarks, escaped]) {
      expect(HireSchema.safeParse({ role_id: "sales-rep", display_name: "Layla", goals }).success).toBe(true);
      expect(EmployeeUpdateSchema.safeParse({ goals }).success).toBe(true);
      // octet_length(goals::text): JSON text plus the space jsonb writes after each comma.
      expect(Buffer.byteLength(JSON.stringify(goals), "utf8") + goals.length - 1).toBeLessThanOrEqual(GOALS_MAX_JSON_BYTES);
    }
    expect(Buffer.byteLength(JSON.stringify(escaped), "utf8") + escaped.length - 1).toBe(9632);
    expect(GoalsSchema.safeParse(Array.from({ length: 9 }, () => "g")).success).toBe(false);
  });

  it("hire: a 23514 from hire_ai_employee is 400 invalid_employee_settings with the field — no raw text", async () => {
    seed([]);
    h.rpcOverride = (fn) => (fn === "hire_ai_employee" ? { error: checkViolation("ai_employees_goals_size") } : undefined);
    const res = await hireReq({ role_id: "sales-rep", display_name: "Layla", goals: Array.from({ length: 8 }, () => "✓".repeat(200)) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ code: "invalid_employee_settings", field: "goals" });
    expect(JSON.stringify(body)).not.toMatch(RAW_DB_TEXT);
  });

  it("PATCH: a 23514 from the update is 400 invalid_employee_settings — no raw text", async () => {
    seed([employee(1)]);
    h.updateError = checkViolation("ai_employees_knowledge_size");
    const res = await patchReq(1, { knowledge: "k" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ code: "invalid_employee_settings", field: "knowledge" });
    expect(JSON.stringify(body)).not.toMatch(RAW_DB_TEXT);
  });

  it("resume: a 23514 from activate_ai_employee is 400 too", async () => {
    seed([employee(1, { status: "paused" })]);
    h.rpcOverride = (fn) => (fn === "activate_ai_employee" ? { error: checkViolation("ai_employees_config_size") } : undefined);
    const res = await patchReq(1, { status: "active", config: { persona_name: "Layla" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_employee_settings", field: "config" });
  });

  it("a character PostgreSQL cannot store (NUL) is refused by the API — nothing is written", async () => {
    seed([employee(1)]);
    for (const body of [{ knowledge: "a\u0000b" }, { goals: ["a\u0000b"] }, { display_name: "La\u0000yla" }, { config: { persona_background: "a\u0000b" } }]) {
      expect((await patchReq(1, body)).status).toBe(400);
    }
    expect(h.service.writes()).toHaveLength(0);
    // …and if one reached the database anyway (22P05), it is still a 400 with no raw text.
    h.updateError = { code: "22P05", message: "unsupported Unicode escape sequence", details: "\\u0000 cannot be converted to text." };
    const res = await patchReq(1, { knowledge: "fine" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_employee_settings" });
  });

  it("any other database failure is a 500 with a stable message", async () => {
    seed([employee(1)]);
    h.updateError = { code: "XX000", message: "internal error on relation ai_employees", details: "secret-knowledge" };
    const res = await patchReq(1, { knowledge: "k" });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(RAW_DB_TEXT);
  });
});
