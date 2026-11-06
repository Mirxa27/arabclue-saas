/**
 * Salla orders waiting for an invoice (RB-S3 / SW-2).
 *   GET   counts by reason (the merchant's own rows and the unlinked rows of its store)
 *   POST  "Issue pending invoices": invoice a batch now, when the merchant can (402/503/409 otherwise)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServiceSupabase } from "@/lib/db/supabase";
import { HttpError } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { pendingOrderCounts, processPendingOrders } from "@/lib/invoices/pending-orders";
import { invoicingReadiness, PENDING_REASON_TEXT } from "@/lib/invoices/order-invoicing";
import { zatcaBlockMessage } from "@/lib/zatca/gates";
import { zatcaRouteError } from "@/lib/zatca/route-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const merchant = await requireMerchantApi();
    return NextResponse.json(await pendingOrderCounts(getServiceSupabase(), merchant));
  } catch (err) {
    return zatcaRouteError(err, "GET /api/invoices/pending");
  }
}

export async function POST(req: NextRequest) {
  try {
    const merchant = await requireMerchantApi();
    const limited = await enforceRateLimit(req, "invoices:pending", 10, 10 * 60_000, merchant.id);
    if (limited instanceof NextResponse) return limited;
    const sb = getServiceSupabase();
    const ready = await invoicingReadiness(sb, merchant);
    if (!ready.ok) {
      if (ready.reason === "not_entitled") throw new HttpError(402, zatcaBlockMessage("not_entitled"), "plan_required");
      if (ready.reason === "zatca_disabled" || ready.reason === "zatca_not_configured") throw new HttpError(503, zatcaBlockMessage(ready.reason), ready.reason);
      const text = PENDING_REASON_TEXT[ready.reason];
      throw new HttpError(409, ready.message ?? `${text.en} / ${text.ar}`, ready.reason === "zatca_not_onboarded" ? "onboard_first" : ready.reason);
    }
    const summary = await processPendingOrders(sb, merchant, { limit: 25, readiness: ready });
    return NextResponse.json({ ...summary, remaining: await pendingOrderCounts(sb, merchant) });
  } catch (err) {
    return zatcaRouteError(err, "POST /api/invoices/pending");
  }
}
