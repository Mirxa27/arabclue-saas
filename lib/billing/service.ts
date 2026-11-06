import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceSupabase } from "@/lib/db/supabase";
import { getPlan, type BillingPlan } from "@/lib/billing/plans";
import { fetchMoyasarPayment, verifyPaymentMatchesIntent } from "@/lib/moyasar/client";
import type { MerchantPlan } from "@/lib/types/database";
import { HttpError, notFound } from "@/lib/api/errors";
import { assertNoDbError } from "@/lib/db/errors";

/*
 * Billing writes run on the service role. merchants.plan / subscription_* and every
 * billing_payments column are not writable through the Data API (see
 * supabase/migrations/20261106001100_api_grants.sql): payment verification trusts
 * billing_payments.amount_halalas and the feature gates trust merchants.plan, so only
 * this server code — after the caller's session/ownership check — may write them.
 */

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

/** Create a pending intent priced from the server-side plan table (never from the client). */
export async function createBillingIntent(merchantId: string, plan: BillingPlan) {
  const planDef = getPlan(plan);
  const supabase = getServiceSupabase();
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

  assertNoDbError(error, "Create billing intent", { merchantId, code: "billing_intent_failed" });
  if (!data) throw new HttpError(500, "Create billing intent failed", "billing_intent_failed");
  return data as BillingPaymentRow;
}

export async function activateSubscription(args: {
  merchantId: string;
  plan: MerchantPlan;
  billingPaymentId: string;
  moyasarPaymentId: string;
  paymentPayload: unknown;
}) {
  return activateSubscriptionWithClient(getServiceSupabase(), args);
}

/**
 * Activate the plan, then mark the payment paid. Order matters: if the second write
 * fails the intent is still unpaid, so the client confirm / Moyasar retry re-runs the
 * whole activation (idempotent) instead of stopping at "already paid" with a merchant
 * that never got the plan.
 */
async function activateSubscriptionWithClient(
  supabase: SupabaseClient,
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

  const { error: merchantErr } = await supabase
    .from("merchants")
    .update({
      plan: args.plan,
      subscription_status: "active",
      billing_cycle_started_at: now.toISOString(),
      subscription_expires_at: expires.toISOString()
    })
    .eq("id", args.merchantId);
  assertNoDbError(merchantErr, "Activate subscription", { merchantId: args.merchantId, code: "activation_failed" });

  const { error: paymentErr } = await supabase
    .from("billing_payments")
    .update({
      status: "paid",
      moyasar_payment_id: args.moyasarPaymentId,
      moyasar_payload: args.paymentPayload,
      paid_at: now.toISOString(),
      updated_at: now.toISOString()
    })
    .eq("id", args.billingPaymentId)
    .eq("merchant_id", args.merchantId);
  assertNoDbError(paymentErr, "Record billing payment", { merchantId: args.merchantId, code: "activation_failed" });
}

/** Client-side confirmation after the Moyasar form; merchantId comes from the session. */
export async function confirmBillingPayment(args: {
  merchantId: string;
  moyasarPaymentId: string;
  intentId: string;
}) {
  return confirmBillingPaymentWithClient(getServiceSupabase(), args);
}

async function confirmBillingPaymentWithClient(
  supabase: SupabaseClient,
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

  if (error || !intent) throw notFound("Billing intent");

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
