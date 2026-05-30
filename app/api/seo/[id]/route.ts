import { NextRequest, NextResponse } from "next/server";
import { requireUserApi, getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUserApi();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("seo_content")
      .select("*")
      .eq("id", params.id)
      .eq("merchant_id", merchant.id)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUserApi();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });
    const supabase = getServerSupabase();
    const { error } = await supabase
      .from("seo_content")
      .delete()
      .eq("id", params.id)
      .eq("merchant_id", merchant.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
