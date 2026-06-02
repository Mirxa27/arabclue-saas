import { NextRequest, NextResponse } from "next/server";
import { requireUserApi, getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { submitToFatoora } from "@/lib/zatca/fatoora";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await requireUserApi();
  const merchant = await getCurrentMerchant();
  if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", params.id)
    .eq("merchant_id", merchant.id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await requireUserApi();
  const merchant = await getCurrentMerchant();
  if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });
  const supabase = await getServerSupabase();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", params.id)
    .eq("merchant_id", merchant.id)
    .single();
  if (error || !invoice) return NextResponse.json({ error: "not found" }, { status: 404 });

  const result = await submitToFatoora({
    xml: invoice.xml,
    uuid: invoice.uuid,
    invoiceHash: invoice.invoice_hash,
    csid: merchant.zatca_csid ?? process.env.ZATCA_CSID,
    base: process.env.ZATCA_FATOORA_BASE
  });

  await supabase
    .from("invoices")
    .update({ status: result.cleared ? "cleared" : "rejected", fatoora_response: result.raw })
    .eq("id", params.id);

  return NextResponse.json(result);
}
