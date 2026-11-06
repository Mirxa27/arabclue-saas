/**
 * F01 follow-through: ai_employees hiring, status and billing columns are no longer
 * writable through the merchant's session, so the employees routes write them with the
 * service role after their ownership/entitlement checks — scoped to the merchant.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, jsonRequest, type FakeHandler, type FakeSupabase } from "../helpers/fake-supabase";
import type { Merchant } from "@/lib/types/database";

const h = vi.hoisted(() => ({
  service: null as unknown as FakeSupabase,
  user: null as unknown as FakeSupabase,
  merchant: null as unknown as Merchant
}));

vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => h.service.client,
  getServerSupabase: async () => h.user.client
}));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, requireMerchantApi: vi.fn(async () => h.merchant) };
});
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import { POST as hire } from "@/app/api/employees/route";
import { DELETE as offboard, PATCH as patchEmployee } from "@/app/api/employees/[id]/route";
import { PATCH as patchStatus } from "@/app/api/employees/[id]/status/route";

let seq = 0;
const EMPLOYEE = "00000000-0000-4000-8000-0000000000e1";

function merchant(): Merchant {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
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
    uninstalled_at: null
  };
}

function useClients(service: FakeHandler, user: FakeHandler) {
  h.service = createFakeSupabase("service", service);
  h.user = createFakeSupabase("user", user);
}

const ownedEmployee = () => ({ id: EMPLOYEE, merchant_id: h.merchant.id, role_id: "sales-rep", display_name: "Layla" });
const ctx = { params: Promise.resolve({ id: EMPLOYEE }) };

beforeEach(() => {
  h.merchant = merchant();
});

describe("POST /api/employees (hire)", () => {
  it("inserts the employee — with its price, trial and billing status — on the service role", async () => {
    useClients(
      (call) => (call.table === "ai_employees" && call.op === "insert" ? { data: { id: EMPLOYEE, ...(call.payload as object) } } : undefined),
      (call) => (call.table === "ai_employees" && call.op === "select" ? { count: 0 } : undefined)
    );
    const res = await hire(jsonRequest("http://localhost/api/employees", { role_id: "sales-rep", display_name: "Layla" }));
    expect(res.status).toBe(200);

    const insert = h.service.writes().find((w) => w.table === "ai_employees")!;
    expect(insert.payload).toMatchObject({ merchant_id: h.merchant.id, billing_status: "trial", status: "active" });
    expect((insert.payload as { monthly_charge_halalas: number }).monthly_charge_halalas).toBeGreaterThan(0);
    expect(h.user.writes().some((w) => w.table === "ai_employees")).toBe(false);
  });
});

describe("PATCH/DELETE /api/employees/:id", () => {
  it("writes status changes with the service role, scoped to the owning merchant", async () => {
    useClients(
      (call) => (call.op === "update" ? { data: { ...ownedEmployee(), status: "paused" } } : undefined),
      (call) => (call.table === "ai_employees" ? { data: ownedEmployee() } : undefined)
    );
    const res = await patchEmployee(jsonRequest(`http://localhost/api/employees/${EMPLOYEE}`, { status: "paused" }, { method: "PATCH" }), ctx);
    expect(res.status).toBe(200);
    const [update] = h.service.writes();
    expect(update.payload).toMatchObject({ status: "paused" });
    expect(update.payload).toHaveProperty("paused_at");
    expect(h.service.filter(update, "merchant_id")).toBe(h.merchant.id);
    expect(h.user.writes()).toHaveLength(0);
  });

  it("offboards with the service role and reports a failed write", async () => {
    useClients(
      () => ({ error: { code: "XX000", message: "boom" } }),
      (call) => (call.table === "ai_employees" ? { data: ownedEmployee() } : undefined)
    );
    const res = await offboard(jsonRequest(`http://localhost/api/employees/${EMPLOYEE}`, undefined, { method: "DELETE" }), ctx);
    expect(res.status).toBe(500);
    expect(h.service.writes()[0].payload).toMatchObject({ status: "offboarded" });
  });

  it("never touches another merchant's employee (404 before any write)", async () => {
    useClients(() => undefined, () => ({ data: null, error: { code: "PGRST116", message: "0 rows" } }));
    const res = await patchEmployee(jsonRequest(`http://localhost/api/employees/${EMPLOYEE}`, { status: "active" }, { method: "PATCH" }), ctx);
    expect(res.status).toBe(404);
    expect(h.service.writes()).toHaveLength(0);
  });
});

describe("PATCH /api/employees/:id/status", () => {
  it("toggles status with the service role, scoped to the merchant", async () => {
    useClients(
      (call) => (call.op === "update" ? { data: { id: EMPLOYEE, status: "active", display_name: "Layla", role_id: "sales-rep" } } : undefined),
      (call) => (call.table === "ai_employees" ? { data: { id: EMPLOYEE } } : undefined)
    );
    const res = await patchStatus(jsonRequest(`http://localhost/api/employees/${EMPLOYEE}/status`, { status: "active" }, { method: "PATCH" }), ctx);
    expect(res.status).toBe(200);
    const [update] = h.service.writes();
    expect(update).toMatchObject({ table: "ai_employees", op: "update" });
    expect(h.service.filter(update, "merchant_id")).toBe(h.merchant.id);
  });
});
