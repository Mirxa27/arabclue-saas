import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi, getCurrentMerchant } from "@/lib/auth/session";
import { getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError, jsonError } from "@/lib/api/route-handler";

export const runtime = "nodejs";

const BodySchema = z.object({
  confirmName: z.string().min(1).max(200)
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUserApi();
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

    const { error: merchantErr } = await supabase.from("merchants").delete().eq("id", merchant.id);
    if (merchantErr) throw new Error(merchantErr.message);

    const { error: authErr } = await supabase.auth.admin.deleteUser(user.id);
    if (authErr) throw new Error(authErr.message);

    await supabase.from("events").insert({
      kind: "merchant.account_deleted",
      merchant: merchant.id,
      payload: { userId: user.id, at: new Date().toISOString() }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
