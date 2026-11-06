/**
 *   GET   the merchant's invoice (RLS: owner only; never gated — it is the merchant's legal record)
 *   POST  "Resubmit to ZATCA": resend a document that got no verdict, or reissue a rejected one as a
 *         corrected new document (lib/invoices/resubmit.ts). Gated like issuing (SW-2): 402 without
 *         an active subscription, 503 disabled / not configured, 409 "onboard first". There is no
 *         platform-wide credential: only the merchant's own EGS unit signs and submits (F14).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase, getServiceSupabase } from "@/lib/db/supabase";
import { notFound } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { zatcaRouteError } from "@/lib/zatca/route-errors";
import { resubmitInvoice } from "@/lib/invoices/resubmit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const IdSchema = z.string().uuid();

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const merchant = await requireMerchantApi();
    const { id } = await props.params;
    if (!IdSchema.safeParse(id).success) throw notFound("Invoice");
    const supabase = await getServerSupabase();
    const { data, error } = await supabase.from("invoices").select("*").eq("id", id).eq("merchant_id", merchant.id).maybeSingle();
    if (error) throw new Error(`invoice lookup failed: ${error.message}`);
    if (!data) throw notFound("Invoice");
    return NextResponse.json(data);
  } catch (err) {
    return zatcaRouteError(err, "GET /api/zatca/invoice/[id]");
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const merchant = await requireMerchantApi();
    const { id } = await props.params;
    if (!IdSchema.safeParse(id).success) throw notFound("Invoice");
    const limited = await enforceRateLimit(req, "zatca:resubmit", 30, 10 * 60_000, merchant.id);
    if (limited instanceof NextResponse) return limited;
    const result = await resubmitInvoice(getServiceSupabase(), merchant, id);
    return NextResponse.json(result);
  } catch (err) {
    return zatcaRouteError(err, "POST /api/zatca/invoice/[id]");
  }
}
