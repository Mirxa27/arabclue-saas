import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi, getCurrentMerchant } from "@/lib/auth/session";
import { getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError, jsonError } from "@/lib/api/route-handler";
import { eraseMerchantData } from "@/lib/merchant/pdpl";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const BodySchema = z.object({
  confirmName: z.string().min(1).max(200)
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUserApi();
    const limited = await enforceRateLimit(req, "merchant:delete-account", 5, 15 * 60_000, user.id);
    if (limited instanceof NextResponse) return limited;

    const merchant = await getCurrentMerchant();
    if (!merchant) return jsonError("no merchant", 400);

    const body = BodySchema.parse(await req.json());
    const expected =
      merchant.seller_name?.trim() ||
      merchant.store_url?.replace(/^https?:\/\//, "").split("/")[0] ||
      merchant.id;

    if (body.confirmName.trim() !== expected) {
      return jsonError("Confirmation name does not match your store name", 400);
    }

    const supabase = getServiceSupabase();
    // PDPL erasure: events (no FK) + cached CR data first, then the merchant row (cascades).
    const report = await eraseMerchantData(supabase, merchant);

    const { error: authErr } = await supabase.auth.admin.deleteUser(user.id);
    if (authErr) throw new Error(authErr.message);

    // Accountability record without any identifier of the erased account.
    await supabase.from("events").insert({
      kind: "merchant.account_deleted",
      merchant: null,
      payload: { at: new Date().toISOString(), eventsDeleted: report.eventsDeleted }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/merchant/delete-account" });
  }
}
