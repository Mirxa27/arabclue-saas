/**
 * F01: billing writes run on the service role (merchants.plan / subscription_* and
 * billing_payments are not writable through the Data API) and every write is checked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeHandler, type FakeSupabase } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({
  service: null as unknown as FakeSupabase,
  user: null as unknown as FakeSupabase,
  payment: null as unknown as Record<string, unknown>
}));

vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => h.service.client,
  getServerSupabase: async () => h.user.client
}));
vi.mock("@/lib/moyasar/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/moyasar/client")>();
  return { ...actual, fetchMoyasarPayment: vi.fn(async () => h.payment) };
});
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import { confirmBillingPayment, createBillingIntent } from "@/lib/billing/service";
import { confirmEmployeeBillingPayment, createEmployeeBillingIntent } from "@/lib/billing/employee-billing";
import { HttpError } from "@/lib/api/errors";
import { MoyasarApiError } from "@/lib/moyasar/types";
import { fetchMoyasarPayment } from "@/lib/moyasar/client";

const MERCHANT = "00000000-0000-4000-8000-0000000000a2";
const INTENT_ID = "00000000-0000-4000-8000-00000000001d";
const PAYMENT_ID = "00000000-0000-4000-8000-0000000000ee";
const EMPLOYEE = "00000000-0000-4000-8000-0000000000e7";

function setClients(service: FakeHandler, user: FakeHandler = () => undefined) {
  h.service = createFakeSupabase("service", service);
  h.user = createFakeSupabase("user", user);
}

beforeEach(() => {
  vi.mocked(fetchMoyasarPayment).mockClear();
  h.payment = {
    id: PAYMENT_ID,
    status: "paid",
    amount: 59900,
    currency: "SAR",
    metadata: { merchant_id: MERCHANT, plan: "pro", intent_id: INTENT_ID },
    created_at: "2026-11-06T00:00:00Z"
  };
});

describe("createBillingIntent", () => {
  it("prices the intent from the server plan table and writes it with the service role", async () => {
    setClients((call) => (call.op === "insert" ? { data: { id: "bp1", ...(call.payload as object) } } : undefined));
    const intent = await createBillingIntent(MERCHANT, "pro");

    expect(h.user.calls).toHaveLength(0);
    const [insert] = h.service.writes();
    expect(insert.table).toBe("billing_payments");
    expect(insert.payload).toMatchObject({ merchant_id: MERCHANT, plan: "pro", amount_halalas: 59900, status: "pending" });
    expect(intent.amount_halalas).toBe(59900);
  });

  it("fails with a stable 500 instead of leaking the database error", async () => {
    setClients(() => ({ error: { code: "42501", message: "permission denied for table billing_payments" } }));
    const err = await createBillingIntent(MERCHANT, "lite").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(500);
    expect((err as HttpError).message).not.toMatch(/permission denied/);
  });
});

describe("confirmBillingPayment", () => {
  const pendingIntent = {
    id: "bp1",
    merchant_id: MERCHANT,
    given_id: INTENT_ID,
    plan: "pro",
    amount_halalas: 59900,
    currency: "SAR",
    status: "pending",
    metadata: { merchant_id: MERCHANT, plan: "pro", intent_id: INTENT_ID }
  };

  it("activates the plan, then marks the payment paid — both on the service role", async () => {
    setClients((call) => (call.op === "select" ? { data: pendingIntent } : undefined));
    const result = await confirmBillingPayment({ merchantId: MERCHANT, moyasarPaymentId: PAYMENT_ID, intentId: INTENT_ID });

    expect(result).toEqual({ alreadyPaid: false, plan: "pro" });
    expect(h.user.calls).toHaveLength(0);
    const writes = h.service.writes();
    expect(writes.map((w) => w.table)).toEqual(["merchants", "billing_payments"]);
    expect(writes[0].payload).toMatchObject({ plan: "pro", subscription_status: "active" });
    expect(h.service.filter(writes[0], "id")).toBe(MERCHANT);
    expect(writes[1].payload).toMatchObject({ status: "paid", moyasar_payment_id: PAYMENT_ID });
    expect(h.service.filter(writes[1], "merchant_id")).toBe(MERCHANT);
  });

  it("does not mark the payment paid when the plan activation fails (a retry must re-activate)", async () => {
    setClients((call) => {
      if (call.op === "select") return { data: pendingIntent };
      if (call.table === "merchants") return { error: { code: "XX000", message: "boom" } };
    });
    await expect(
      confirmBillingPayment({ merchantId: MERCHANT, moyasarPaymentId: PAYMENT_ID, intentId: INTENT_ID })
    ).rejects.toBeInstanceOf(HttpError);
    expect(h.service.writes().map((w) => w.table)).toEqual(["merchants"]);
  });

  it("refuses a payment whose amount differs from the stored intent", async () => {
    setClients((call) => (call.op === "select" ? { data: pendingIntent } : undefined));
    h.payment = { ...h.payment, amount: 100 };
    await expect(
      confirmBillingPayment({ merchantId: MERCHANT, moyasarPaymentId: PAYMENT_ID, intentId: INTENT_ID })
    ).rejects.toBeInstanceOf(MoyasarApiError);
    expect(h.service.writes()).toHaveLength(0);
  });

  it("is idempotent for an already-paid intent", async () => {
    setClients((call) => (call.op === "select" ? { data: { ...pendingIntent, status: "paid" } } : undefined));
    const result = await confirmBillingPayment({ merchantId: MERCHANT, moyasarPaymentId: PAYMENT_ID, intentId: INTENT_ID });
    expect(result.alreadyPaid).toBe(true);
    expect(fetchMoyasarPayment).not.toHaveBeenCalled();
    expect(h.service.writes()).toHaveLength(0);
  });
});

describe("employee seat billing", () => {
  const employee = {
    id: EMPLOYEE,
    merchant_id: MERCHANT,
    role_id: "sales-rep",
    display_name: "Layla",
    hire_plan: "starter",
    monthly_charge_halalas: 9900
  };

  it("reads the employee through the merchant's session and writes the intent with the service role", async () => {
    setClients(
      (call) => (call.op === "insert" ? { data: { id: "bp2", ...(call.payload as object) } } : undefined),
      (call) => (call.table === "ai_employees" ? { data: employee } : undefined)
    );
    const { intent } = await createEmployeeBillingIntent(MERCHANT, EMPLOYEE);

    expect(h.user.writes()).toHaveLength(0);
    expect(h.user.calls[0]).toMatchObject({ table: "ai_employees", op: "select" });
    const [insert] = h.service.writes();
    expect(insert).toMatchObject({ table: "billing_payments", op: "insert" });
    expect(insert.payload).toMatchObject({ plan: "employee", amount_halalas: 9900 });
    expect(intent.amount_halalas).toBe(9900);
  });

  it("activates the seat before marking the intent paid", async () => {
    h.payment = {
      ...h.payment,
      amount: 9900,
      metadata: { merchant_id: MERCHANT, employee_id: EMPLOYEE, intent_id: INTENT_ID, type: "employee" }
    };
    setClients((call) =>
      call.op === "select"
        ? {
            data: {
              id: "bp2",
              merchant_id: MERCHANT,
              given_id: INTENT_ID,
              plan: "employee",
              amount_halalas: 9900,
              currency: "SAR",
              status: "pending",
              metadata: { employee_id: EMPLOYEE }
            }
          }
        : undefined
    );
    await confirmEmployeeBillingPayment({ merchantId: MERCHANT, moyasarPaymentId: PAYMENT_ID, intentId: INTENT_ID });
    const writes = h.service.writes();
    expect(writes.map((w) => w.table)).toEqual(["ai_employees", "billing_payments"]);
    expect(writes[0].payload).toMatchObject({ billing_status: "active", status: "active" });
    expect(h.service.filter(writes[0], "merchant_id")).toBe(MERCHANT);
  });
});
