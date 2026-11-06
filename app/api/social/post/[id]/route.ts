import { NextRequest, NextResponse } from "next/server";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase, getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { HttpError, notFound } from "@/lib/api/errors";
import { assertNoDbError } from "@/lib/db/errors";
import { reportError } from "@/lib/observability/error-reporter";
import { merchantCanUseFeature } from "@/lib/billing/entitlements";
import { PostPatchSchema, decidePostPatch, type StoredPost } from "@/lib/social/post-edit";
import { enableSocialAgentOnFirstConnect, loadSocialAgentState, socialAgentActive } from "@/lib/social/gates";

const PATCH_COLUMNS = "id, status, scheduled_for, platforms, copies, media, publish_results";

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
  const route = "PATCH /api/social/post/:id";
  try {
    const { id } = await props.params;
    const merchant = await requireMerchantApi();
    const patch = PostPatchSchema.parse(await req.json());
    const supabase = await getServerSupabase();

    const { data: current, error: readErr } = await supabase
      .from("social_posts")
      .select(PATCH_COLUMNS)
      .eq("id", id)
      .eq("merchant_id", merchant.id)
      .maybeSingle();
    assertNoDbError(readErr, "Load post", { route, merchantId: merchant.id });
    if (!current) throw notFound("Post");

    const decision = decidePostPatch(current as StoredPost, patch, {
      now: new Date(),
      entitled: merchantCanUseFeature(merchant, "social")
    });

    const { data, error } = await supabase
      .from("social_posts")
      .update(decision.update)
      .eq("id", id)
      .eq("merchant_id", merchant.id)
      .eq("status", decision.expectedStatus)
      .select("id, status");
    assertNoDbError(error, "Update post", { route, merchantId: merchant.id });
    if (!data?.length) {
      throw new HttpError(409, "This post changed while you were editing it. Reload and try again.", "post_changed");
    }

    // Approving / re-queueing is the merchant's intent to publish: a first-time user gets the social
    // agent switched on (insert-only — an agent they paused stays paused, and the UI says so).
    let agentActive: boolean | undefined;
    if (decision.nextStatus === "scheduled") {
      const service = getServiceSupabase();
      try {
        await enableSocialAgentOnFirstConnect(merchant.id, service);
        agentActive = socialAgentActive(await loadSocialAgentState(service, merchant.id));
      } catch (err) {
        reportError(err, { route, merchantId: merchant.id, extra: { step: "social agent state" } });
      }
    }

    return NextResponse.json({ ok: true, status: decision.nextStatus, ...(agentActive === undefined ? {} : { agentActive }) });
  } catch (err) {
    return handleRouteError(err, { route });
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const route = "DELETE /api/social/post/:id";
  try {
    const { id } = await props.params;
    const merchant = await requireMerchantApi();
    const supabase = await getServerSupabase();
    // A post being published right now is not deleted out from under the publishing run.
    const { data, error } = await supabase
      .from("social_posts")
      .delete()
      .eq("id", id)
      .eq("merchant_id", merchant.id)
      .neq("status", "publishing")
      .select("id");
    assertNoDbError(error, "Delete post", { route, merchantId: merchant.id });
    if (!data?.length) {
      const { data: exists } = await supabase
        .from("social_posts")
        .select("id")
        .eq("id", id)
        .eq("merchant_id", merchant.id)
        .maybeSingle();
      if (exists) throw new HttpError(409, "This post is being published right now", "post_publishing");
      throw notFound("Post");
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, { route });
  }
}
