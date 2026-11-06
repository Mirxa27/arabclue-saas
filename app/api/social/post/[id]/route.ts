import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { notFound } from "@/lib/api/errors";

const PatchSchema = z.object({
  scheduledFor: z.iso.datetime({ offset: true }).optional(),
  status: z.enum(["scheduled", "canceled"]).optional(),
  copies: z.record(z.string(), z.unknown()).optional(),
  hook: z.string().max(500).optional()
});

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await props.params;
    const merchant = await requireMerchantApi();
    const supabase = await getServerSupabase();
    const { data, error } = await supabase
      .from("social_posts")
      .select("*")
      .eq("id", id)
      .eq("merchant_id", merchant.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw notFound("Post");
    return NextResponse.json(data);
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/social/post/:id" });
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await props.params;
    const merchant = await requireMerchantApi();
    const body = PatchSchema.parse(await req.json());
    const supabase = await getServerSupabase();
    const { data, error } = await supabase
      .from("social_posts")
      .update({
        scheduled_for: body.scheduledFor,
        status: body.status,
        copies: body.copies,
        hook: body.hook
      })
      .eq("id", id)
      .eq("merchant_id", merchant.id)
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data?.length) throw notFound("Post");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, { route: "PATCH /api/social/post/:id" });
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await props.params;
    const merchant = await requireMerchantApi();
    const supabase = await getServerSupabase();
    const { data, error } = await supabase
      .from("social_posts")
      .delete()
      .eq("id", id)
      .eq("merchant_id", merchant.id)
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data?.length) throw notFound("Post");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, { route: "DELETE /api/social/post/:id" });
  }
}
