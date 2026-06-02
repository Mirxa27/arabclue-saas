import { getServerSupabase, getServiceSupabase } from "@/lib/db/supabase";
import { fetchMoyasarPayment, verifyPaymentMatchesIntent } from "@/lib/moyasar/client";
import type { AIEmployeeRow } from "@/lib/employees/types";

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

export async function createEmployeeBillingIntent(merchantId: string, employeeId: string) {
  const sb = await getServerSupabase();
  const { data: employee, error: empErr } = await sb
    .from("ai_employees")
    .select("*")
    .eq("id", employeeId)
    .eq("merchant_id", merchantId)
    .single();
  if (empErr || !employee) throw new Error("Employee not found");

  const row = employee as AIEmployeeRow & { billing_status?: string };
  const givenId = crypto.randomUUID();
  const amount = row.monthly_charge_halalas;

  const { data, error } = await sb
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

  if (error || !data) throw new Error(error?.message ?? "Failed to create billing intent");
  return { intent: data as EmployeeBillingPaymentRow, employee: row };
}

export async function confirmEmployeeBillingPayment(args: {
  merchantId: string;
  moyasarPaymentId: string;
  intentId: string;
}) {
  return confirmEmployeeBillingWithClient(await getServerSupabase(), args);
}

async function confirmEmployeeBillingWithClient(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  args: { merchantId: string; moyasarPaymentId: string; intentId: string }
) {
  const { data: intent, error } = await supabase
    .from("billing_payments")
    .select("*")
    .eq("merchant_id", args.merchantId)
    .eq("given_id", args.intentId)
    .maybeSingle();

  if (error || !intent) throw new Error("Billing intent not found");

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

  await supabase
    .from("billing_payments")
    .update({
      status: "paid",
      moyasar_payment_id: payment.id,
      moyasar_payload: payment,
      paid_at: now.toISOString(),
      updated_at: now.toISOString()
    })
    .eq("id", row.id);

  await supabase
    .from("ai_employees")
    .update({
      billing_status: "active",
      last_billing_payment_id: row.id,
      next_billing_at: nextBilling.toISOString(),
      status: "active"
    })
    .eq("id", employeeId)
    .eq("merchant_id", args.merchantId);

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
