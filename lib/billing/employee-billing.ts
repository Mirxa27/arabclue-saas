import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase, getServiceSupabase } from "@/lib/db/supabase";
import { fetchMoyasarPayment, verifyPaymentMatchesIntent } from "@/lib/moyasar/client";
import type { AIEmployeeRow } from "@/lib/employees/types";
import { HttpError, notFound } from "@/lib/api/errors";
import { assertNoDbError } from "@/lib/db/errors";

const SUBSCRIPTION_DAYS = 30;

export type EmployeeBillingPaymentRow = {
  id: string;
  merchant_id: string;
  moyasar_payment_id: string | null;
  given_id: string;
  plan: "employee";
  amount_halalas: number;
  currency: string;
  description: string | null;
  status: string;
  metadata: Record<string, string> | null;
};

/**
 * Create a seat billing intent. The employee is read through the merchant's own
 * session (RLS proves ownership); the intent is written by the service role because
 * billing_payments is not writable through the Data API. The price comes from
 * ai_employees.monthly_charge_halalas, which only the server can set.
 */
export async function createEmployeeBillingIntent(merchantId: string, employeeId: string) {
  const sb = await getServerSupabase();
  const { data: employee, error: empErr } = await sb
    .from("ai_employees")
    .select("*")
    .eq("id", employeeId)
    .eq("merchant_id", merchantId)
    .single();
  if (empErr || !employee) throw notFound("Employee");

  const row = employee as AIEmployeeRow & { billing_status?: string };
  const givenId = crypto.randomUUID();
  const amount = row.monthly_charge_halalas;

  const { data, error } = await getServiceSupabase()
    .from("billing_payments")
    .insert({
      merchant_id: merchantId,
      given_id: givenId,
      plan: "employee",
      amount_halalas: amount,
      currency: "SAR",
      status: "pending",
      description: `AI employee — ${row.display_name} (monthly)`,
      metadata: {
        type: "employee",
        merchant_id: merchantId,
        employee_id: employeeId,
        role_id: row.role_id,
        hire_plan: row.hire_plan,
        intent_id: givenId
      }
    })
    .select("*")
    .single();

  assertNoDbError(error, "Create employee billing intent", { merchantId, code: "billing_intent_failed" });
  if (!data) throw new HttpError(500, "Create employee billing intent failed", "billing_intent_failed");
  return { intent: data as EmployeeBillingPaymentRow, employee: row };
}

/** Client-side confirmation; merchantId comes from the session. */
export async function confirmEmployeeBillingPayment(args: {
  merchantId: string;
  moyasarPaymentId: string;
  intentId: string;
}) {
  return confirmEmployeeBillingWithClient(getServiceSupabase(), args);
}

async function confirmEmployeeBillingWithClient(
  supabase: SupabaseClient,
  args: { merchantId: string; moyasarPaymentId: string; intentId: string }
) {
  const { data: intent, error } = await supabase
    .from("billing_payments")
    .select("*")
    .eq("merchant_id", args.merchantId)
    .eq("given_id", args.intentId)
    .maybeSingle();

  if (error || !intent) throw notFound("Billing intent");

  const row = intent as EmployeeBillingPaymentRow;
  if (row.plan !== "employee") throw new Error("Not an employee billing intent");

  const employeeId = row.metadata?.employee_id;
  if (!employeeId) throw new Error("Missing employee_id in billing metadata");

  if (row.status === "paid") {
    return { alreadyPaid: true, employeeId };
  }

  const payment = await fetchMoyasarPayment(args.moyasarPaymentId);

  verifyPaymentMatchesIntent({
    payment,
    expectedAmountHalalas: row.amount_halalas,
    expectedCurrency: row.currency,
    expectedMetadata: {
      merchant_id: args.merchantId,
      employee_id: employeeId,
      intent_id: row.given_id
    }
  });

  const now = new Date();
  const nextBilling = new Date(now);
  nextBilling.setDate(nextBilling.getDate() + SUBSCRIPTION_DAYS);

  // Activate the seat first, then mark the intent paid: a failure between the two leaves
  // the intent unpaid so a retry re-runs the activation instead of returning "already
  // paid" for a seat that was never activated.
  const { error: employeeErr } = await supabase
    .from("ai_employees")
    .update({
      billing_status: "active",
      last_billing_payment_id: row.id,
      next_billing_at: nextBilling.toISOString(),
      status: "active"
    })
    .eq("id", employeeId)
    .eq("merchant_id", args.merchantId);
  assertNoDbError(employeeErr, "Activate employee seat", { merchantId: args.merchantId, code: "activation_failed" });

  const { error: paymentErr } = await supabase
    .from("billing_payments")
    .update({
      status: "paid",
      moyasar_payment_id: payment.id,
      moyasar_payload: payment,
      paid_at: now.toISOString(),
      updated_at: now.toISOString()
    })
    .eq("id", row.id)
    .eq("merchant_id", args.merchantId);
  assertNoDbError(paymentErr, "Record employee billing payment", { merchantId: args.merchantId, code: "activation_failed" });

  return { alreadyPaid: false, employeeId };
}

/** Called from Moyasar webhook when metadata.type === employee */
export async function handleEmployeeMoyasarWebhook(paymentId: string) {
  const payment = await fetchMoyasarPayment(paymentId);
  if (payment.status !== "paid") return { handled: false, reason: "not_paid" };

  const merchantId = payment.metadata?.merchant_id;
  const intentId = payment.metadata?.intent_id;
  if (!merchantId || !intentId || payment.metadata?.type !== "employee") {
    return { handled: false, reason: "missing_metadata" };
  }

  await confirmEmployeeBillingWithClient(getServiceSupabase(), {
    merchantId,
    moyasarPaymentId: payment.id,
    intentId
  });
  return { handled: true, merchantId, employeeId: payment.metadata.employee_id };
}
