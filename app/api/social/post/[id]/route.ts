import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi, getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";

const PatchSchema = z.object({
  scheduledFor: z.string().optional(),
  status: z.enum(["scheduled", "canceled"]).optional(),
  copies: z.record(z.unknown()).optional(),
  hook: z.string().optional()
});

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await requireUserApi();
  const merchant = await getCurrentMerchant();
  if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("social_posts")
    .select("*")
    .eq("id", params.id)
    .eq("merchant_id", merchant.id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await requireUserApi();
  const merchant = await getCurrentMerchant();
  if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });
  const body = PatchSchema.parse(await req.json());
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("social_posts")
    .update({
      scheduled_for: body.scheduledFor,
      status: body.status,
      copies: body.copies,
      hook: body.hook
    })
    .eq("id", params.id)
    .eq("merchant_id", merchant.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await requireUserApi();
  const merchant = await getCurrentMerchant();
  if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });
  const supabase = await getServerSupabase();
  await supabase.from("social_posts").delete().eq("id", params.id).eq("merchant_id", merchant.id);
  return NextResponse.json({ ok: true });
}
