import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi, getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";

const Schema = z.object({
  seller_name: z.string().min(1),
  vat_number: z.string().regex(/^\d{15}$/, "VAT must be 15 digits"),
  cr_number: z.string().regex(/^\d{10}$/, "CR must be 10 digits").optional().or(z.literal("")),
  seller_address: z.object({
    street: z.string(),
    building: z.string(),
    city: z.string(),
    postalCode: z.string().regex(/^\d{5}$/, "Postal code must be 5 digits"),
    district: z.string().optional()
  })
});

export async function POST(req: NextRequest) {
  await requireUserApi();
  const merchant = await getCurrentMerchant();
  if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const supabase = await getServerSupabase();
  const { error } = await supabase.from("merchants").update(parsed.data).eq("id", merchant.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
