import { NextRequest, NextResponse } from "next/server";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError, formatZodIssues } from "@/lib/api/route-handler";
import { TaxSettingsSchema } from "@/lib/merchant/tax-schema";

export async function POST(req: NextRequest) {
  try {
    const merchant = await requireMerchantApi();
    const parsed = TaxSettingsSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodIssues(parsed.error) }, { status: 400 });
    }
    const supabase = await getServerSupabase();
    const { error } = await supabase.from("merchants").update(parsed.data).eq("id", merchant.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/merchant/tax" });
  }
}
