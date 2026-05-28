import { NextResponse } from "next/server";
import { requireUser, getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";

export async function POST() {
  try {
    await requireUser();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });

    const supabase = getServerSupabase();
    const { error } = await supabase
      .from("merchants")
      .update({
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        salla_state: null,
        uninstalled_at: new Date().toISOString()
      })
      .eq("id", merchant.id);

    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
