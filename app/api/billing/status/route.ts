import { NextResponse } from "next/server";
import { requireUser, getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { getPlan } from "@/lib/billing/plans";

export async function GET() {
  try {
    await requireUser();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });

    const supabase = getServerSupabase();
    const { data: lastPayment } = await supabase
      .from("billing_payments")
      .select("plan, status, paid_at, amount_halalas")
      .eq("merchant_id", merchant.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const plan = merchant.plan;
    const planDef = plan === "lite" || plan === "plus" || plan === "pro" ? getPlan(plan) : null;

    return NextResponse.json({
      plan: merchant.plan,
      subscriptionStatus: merchant.subscription_status ?? "pending",
      subscriptionExpiresAt: merchant.subscription_expires_at ?? null,
      planDetails: planDef,
      lastPayment: lastPayment ?? null
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
