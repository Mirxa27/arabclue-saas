import { getServerSupabase, getServiceSupabase } from "@/lib/db/supabase";
import { getPlan, type BillingPlan } from "@/lib/billing/plans";
import { fetchMoyasarPayment, verifyPaymentMatchesIntent } from "@/lib/moyasar/client";
import type { MerchantPlan } from "@/lib/types/database";

const SUBSCRIPTION_DAYS = 30;

export type BillingPaymentRow = {
  id: string;
  merchant_id: string;
  moyasar_payment_id: string | null;
  given_id: string;
  plan: BillingPlan;
  amount_halalas: number;
  currency: string;
  status: string;
  metadata: Record<string, string> | null;
};

export async function createBillingIntent(merchantId: string, plan: BillingPlan) {
  const planDef = getPlan(plan);
  const supabase = getServerSupabase();
  const givenId = crypto.randomUUID();

  const { data, error } = await supabase
    .from("billing_payments")
    .insert({
      merchant_id: merchantId,
      given_id: givenId,
      plan,
      amount_halalas: planDef.amountHalalas,
      currency: planDef.currency,
      status: "pending",
      description: planDef.description,
      metadata: {
        merchant_id: merchantId,
        plan,
        intent_id: givenId
      }
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create billing intent");
  return data as BillingPaymentRow;
}

export async function activateSubscription(args: {
  merchantId: string;
  plan: MerchantPlan;
  billingPaymentId: string;
  moyasarPaymentId: string;
  paymentPayload: unknown;
}) {
  return activateSubscriptionWithClient(getServerSupabase(), args);
}

async function activateSubscriptionWithClient(
  supabase: ReturnType<typeof getServerSupabase>,
  args: {
    merchantId: string;
    plan: MerchantPlan;
    billingPaymentId: string;
    moyasarPaymentId: string;
    paymentPayload: unknown;
  }
) {
  const now = new Date();
  const expires = new Date(now);
  expires.setDate(expires.getDate() + SUBSCRIPTION_DAYS);

  await supabase
    .from("merchants")
    .update({
      plan: args.plan,
      subscription_status: "active",
      billing_cycle_started_at: now.toISOString(),
      subscription_expires_at: expires.toISOString()
    })
    .eq("id", args.merchantId);

  await supabase
    .from("billing_payments")
    .update({
      status: "paid",
      moyasar_payment_id: args.moyasarPaymentId,
      moyasar_payload: args.paymentPayload,
      paid_at: now.toISOString(),
      updated_at: now.toISOString()
    })
    .eq("id", args.billingPaymentId);
}

export async function confirmBillingPayment(args: {
  merchantId: string;
  moyasarPaymentId: string;
  intentId: string;
}) {
  return confirmBillingPaymentWithClient(getServerSupabase(), args);
}

async function confirmBillingPaymentWithClient(
  supabase: ReturnType<typeof getServerSupabase>,
  args: {
    merchantId: string;
    moyasarPaymentId: string;
    intentId: string;
  }
) {

  const { data: intent, error } = await supabase
    .from("billing_payments")
    .select("*")
    .eq("merchant_id", args.merchantId)
    .eq("given_id", args.intentId)
    .maybeSingle();

  if (error || !intent) throw new Error("Billing intent not found");

  const row = intent as BillingPaymentRow;
  if (row.status === "paid") {
    return { alreadyPaid: true, plan: row.plan as BillingPlan };
  }

  const payment = await fetchMoyasarPayment(args.moyasarPaymentId);

  verifyPaymentMatchesIntent({
    payment,
    expectedAmountHalalas: row.amount_halalas,
    expectedCurrency: row.currency,
    expectedMetadata: {
      merchant_id: args.merchantId,
      plan: row.plan,
      intent_id: row.given_id
    }
  });

  if (payment.metadata?.merchant_id && payment.metadata.merchant_id !== args.merchantId) {
    throw new Error("Payment merchant mismatch");
  }

  await activateSubscriptionWithClient(supabase, {
    merchantId: args.merchantId,
    plan: row.plan as MerchantPlan,
    billingPaymentId: row.id,
    moyasarPaymentId: payment.id,
    paymentPayload: payment
  });

  return { alreadyPaid: false, plan: row.plan as BillingPlan };
}

export async function handleMoyasarWebhookPayment(paymentId: string) {
  const payment = await fetchMoyasarPayment(paymentId);
  if (payment.status !== "paid") return { handled: false, reason: "not_paid" };

  const merchantId = payment.metadata?.merchant_id;
  const intentId = payment.metadata?.intent_id;

  if (payment.metadata?.type === "employee") {
    const { handleEmployeeMoyasarWebhook } = await import("@/lib/billing/employee-billing");
    return handleEmployeeMoyasarWebhook(paymentId);
  }

  const plan = payment.metadata?.plan as BillingPlan | undefined;

  if (!merchantId || !intentId || !plan) {
    return { handled: false, reason: "missing_metadata" };
  }

  await confirmBillingPaymentWithClient(getServiceSupabase(), { merchantId, moyasarPaymentId: payment.id, intentId });
  return { handled: true, merchantId, plan };
}
