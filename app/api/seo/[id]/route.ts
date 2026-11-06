import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { HttpError, notFound } from "@/lib/api/errors";
import { assertNoDbError } from "@/lib/db/errors";
import { SEO_CONTENT_COLUMNS } from "@/lib/seo/generate";

export const dynamic = "force-dynamic";

const IdSchema = z.string().uuid();

function contentId(raw: string): string {
  const parsed = IdSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "Invalid content id", "invalid_id");
  return parsed.data;
}

/** One generated SEO item of the signed-in merchant (RLS-scoped). 400 bad id · 404 not theirs / missing. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const merchant = await requireMerchantApi();
    const id = contentId(params.id);
    const supabase = await getServerSupabase();
    const { data, error } = await supabase
      .from("seo_content")
      .select(SEO_CONTENT_COLUMNS)
      .eq("id", id)
      .eq("merchant_id", merchant.id)
      .maybeSingle();
    assertNoDbError(error, "Load SEO content", { route: "GET /api/seo/[id]", merchantId: merchant.id, code: "db_read_failed" });
    if (!data) throw notFound("SEO content");
    return NextResponse.json(data);
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/seo/[id]" });
  }
}

/** Delete one generated item. Does not give back the monthly generation quota. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const merchant = await requireMerchantApi();
    const id = contentId(params.id);
    const supabase = await getServerSupabase();
    const { data, error } = await supabase
      .from("seo_content")
      .delete()
      .eq("id", id)
      .eq("merchant_id", merchant.id)
      .select("id");
    assertNoDbError(error, "Delete SEO content", { route: "DELETE /api/seo/[id]", merchantId: merchant.id });
    if (!Array.isArray(data) || data.length === 0) throw notFound("SEO content");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, { route: "DELETE /api/seo/[id]" });
  }
}
