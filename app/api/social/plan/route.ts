import { NextRequest, NextResponse } from "next/server";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase, getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { handlePlanRequest } from "@/lib/social/plan-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** Generate a content plan as drafts (lib/social/plan-service.ts). */
export async function POST(req: NextRequest) {
  try {
    const merchant = await requireMerchantApi();
    return await handlePlanRequest(req, merchant, {
      userClient: await getServerSupabase(),
      serviceClient: getServiceSupabase()
    });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/social/plan" });
  }
}

export async function GET() {
  try {
    const merchant = await requireMerchantApi();
    const supabase = await getServerSupabase();
    const { data, error } = await supabase
      .from("social_posts")
      .select("*")
      .eq("merchant_id", merchant.id)
      .order("scheduled_for", { ascending: true })
      .limit(60);
    if (error) throw new Error(`social_posts lookup failed: ${error.message}`);
    return NextResponse.json({ posts: data ?? [] });
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/social/plan" });
  }
}
