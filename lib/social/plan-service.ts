/**
 * POST /api/social/plan — gates, throttles, single flight, generation, draft inserts.
 *
 * Order matters for cost: everything that is free to check (switches, plan, body, brand kit,
 * connected channels, existing drafts) is checked before the strict per-merchant rate limit and
 * the database-backed single-flight + daily quota (social_begin_plan_run), and only then is any
 * LLM called. Generated posts are inserted as 'draft'.
 */
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAgentSettings } from "@/lib/admin/platform-settings";
import { formatZodIssues } from "@/lib/api/route-handler";
import { featureGateMessage, merchantCanUseFeature } from "@/lib/billing/entitlements";
import { assertNoDbError } from "@/lib/db/errors";
import { redactSensitive, reportError } from "@/lib/observability/error-reporter";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import type { Merchant, SallaProduct } from "@/lib/types/database";
import { generateSocialPlan, PLAN_LIMITS, PlanRequestSchema } from "./plan";
import {
  PUBLISHABLE_PLATFORMS,
  isPublishablePlatform,
  type BrandVoice,
  type Platform,
  type Product,
  type PublishablePlatform
} from "./types";

const ROUTE = "POST /api/social/plan";

export type PlanServiceDeps = {
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
  generate?: typeof generateSocialPlan;
  now?: () => Date;
};

const json = (body: Record<string, unknown>, status: number, headers?: Record<string, string>) =>
  NextResponse.json(body, { status, ...(headers ? { headers } : {}) });

function toProduct(p: SallaProduct): Product {
  return {
    id: p.salla_product_id,
    name: p.name,
    arabicName: p.arabic_name ?? undefined,
    description: p.description ?? "",
    price: Number(p.price ?? 0),
    currency: "SAR",
    category: p.category ?? "general",
    imageUrl: p.image_url ?? undefined,
    url: p.url ?? undefined
  };
}

/** The merchant's connected channels that can publish (and are not waiting for a reconnect). */
async function publishableChannels(
  sb: SupabaseClient,
  merchantId: string
): Promise<{ ready: PublishablePlatform[]; reconnect: Platform[]; connected: Platform[] }> {
  const { data, error } = await sb
    .from("social_channels")
    .select("platform, access_token_encrypted, token_invalid_at")
    .eq("merchant_id", merchantId);
  assertNoDbError(error, "Load social channels", { route: ROUTE, merchantId });
  const rows = (data ?? []) as Array<{ platform: Platform; access_token_encrypted: string | null; token_invalid_at: string | null }>;
  const connected = rows.filter((r) => r.access_token_encrypted).map((r) => r.platform);
  const reconnect = rows.filter((r) => r.access_token_encrypted && r.token_invalid_at).map((r) => r.platform);
  const ready = PUBLISHABLE_PLATFORMS.filter((p) => connected.includes(p) && !reconnect.includes(p));
  return { ready, reconnect, connected };
}

export async function handlePlanRequest(req: NextRequest, merchant: Merchant, deps: PlanServiceDeps): Promise<NextResponse> {
  const now = deps.now ?? (() => new Date());

  const agents = await getAgentSettings();
  if (!agents.social.enabled) {
    return json({ error: "Social agent is disabled platform-wide", code: "social_disabled" }, 503);
  }
  if (!merchantCanUseFeature(merchant, "social")) {
    return json({ error: featureGateMessage("social"), code: "plan_required" }, 402);
  }
  // Cheap requests (validation errors, missing setup) are throttled loosely…
  const loose = await enforceRateLimit(req, "social:plan:req", 20, 60_000, { identity: merchant.id });
  if (loose instanceof NextResponse) return loose;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const parsed = PlanRequestSchema.safeParse(raw ?? {});
  if (!parsed.success) return json({ error: formatZodIssues(parsed.error), code: "invalid_request" }, 400);
  const body = parsed.data;

  const { data: kit, error: kitErr } = await deps.userClient
    .from("brand_kits")
    .select("*")
    .eq("merchant_id", merchant.id)
    .maybeSingle();
  assertNoDbError(kitErr, "Load brand kit", { route: ROUTE, merchantId: merchant.id });
  if (!kit) return json({ error: "brand kit not configured", code: "brand_kit_missing" }, 400);

  const channels = await publishableChannels(deps.serviceClient, merchant.id);
  let platforms: PublishablePlatform[];
  if (body.platforms) {
    const unsupported = body.platforms.filter((p) => !isPublishablePlatform(p));
    if (unsupported.length) {
      return json({ error: `Publishing to ${unsupported.join(", ")} isn't available yet`, code: "platform_unsupported" }, 400);
    }
    const notReady = body.platforms.filter((p) => !(channels.ready as readonly string[]).includes(p));
    if (notReady.length) {
      const needsReconnect = notReady.filter((p) => channels.reconnect.includes(p));
      return json(
        {
          error: needsReconnect.length
            ? `Reconnect ${needsReconnect.join(", ")} before planning posts for it`
            : `Connect ${notReady.join(", ")} before planning posts for it`,
          code: needsReconnect.length ? "platform_reconnect_required" : "platform_not_connected"
        },
        400
      );
    }
    platforms = [...new Set(body.platforms)] as PublishablePlatform[];
  } else {
    platforms = channels.ready;
  }
  if (platforms.length === 0) {
    return json(
      { error: "Connect Instagram, X or LinkedIn to generate a publishable plan", code: "no_connected_platforms" },
      400
    );
  }

  const { count: drafts, error: draftErr } = await deps.userClient
    .from("social_posts")
    .select("id", { count: "exact", head: true })
    .eq("merchant_id", merchant.id)
    .eq("status", "draft");
  assertNoDbError(draftErr, "Count drafts", { route: ROUTE, merchantId: merchant.id });
  if ((drafts ?? 0) > 0 && !body.replaceDrafts) {
    return json(
      {
        error: `You have ${drafts} unapproved draft posts from an earlier plan. Send replaceDrafts: true to replace them.`,
        code: "drafts_exist",
        drafts
      },
      409
    );
  }

  // …and generation strictly: one per merchant per window, whatever the IP.
  const strict = await enforceRateLimit(req, "social:plan", 1, PLAN_LIMITS.rateLimitWindowMs, { identity: merchant.id });
  if (strict instanceof NextResponse) return strict;

  const { data: runRows, error: runErr } = await deps.serviceClient.rpc("social_begin_plan_run", {
    p_merchant_id: merchant.id,
    p_daily_quota: PLAN_LIMITS.dailyQuota,
    p_stale_seconds: PLAN_LIMITS.staleRunSeconds
  });
  assertNoDbError(runErr, "Start plan generation", { route: ROUTE, merchantId: merchant.id });
  const run = (Array.isArray(runRows) ? runRows[0] : runRows) as
    | { run_id: string | null; outcome: string; retry_after_seconds: number | null }
    | undefined;
  if (!run || run.outcome === "busy" || !run.run_id) {
    if (run?.outcome === "quota_exceeded") {
      const retry = String(run.retry_after_seconds ?? 3600);
      return json(
        { error: `Daily plan limit reached (${PLAN_LIMITS.dailyQuota} per 24 hours)`, code: "plan_quota_exceeded" },
        429,
        { "Retry-After": retry }
      );
    }
    return json({ error: "A plan is already being generated", code: "plan_in_progress" }, 409, { "Retry-After": "30" });
  }
  const runId = run.run_id;

  const finishRun = async (values: Record<string, unknown>) => {
    const { error } = await deps.serviceClient
      .from("social_plan_runs")
      .update({ finished_at: now().toISOString(), ...values })
      .eq("id", runId);
    if (error) reportError(new Error(`social_plan_runs update failed: ${error.message}`), { route: ROUTE, merchantId: merchant.id });
  };

  try {
    const { data: products, error: productErr } = await deps.userClient
      .from("salla_products")
      .select("*")
      .eq("merchant_id", merchant.id)
      .limit(100);
    assertNoDbError(productErr, "Load products", { route: ROUTE, merchantId: merchant.id });

    const brand: BrandVoice = {
      name: kit.brand_name,
      essence: kit.essence ?? "",
      attributes: kit.attributes ?? [],
      favorWords: kit.favor_words ?? [],
      avoidWords: kit.avoid_words ?? [],
      dialect: kit.dialect ?? "khaliji"
    };

    const generate = deps.generate ?? generateSocialPlan;
    const { posts, stats } = await generate({
      brand,
      products: ((products ?? []) as SallaProduct[]).map(toProduct),
      platforms,
      horizonDays: body.horizonDays,
      postsPerWeek: body.postsPerWeek,
      now: now()
    });

    if (posts.length === 0) {
      await finishRun({ status: "failed", llm_calls: stats.llmCalls, error: "no publishable posts" });
      return json(
        { error: "The planner produced no publishable posts. Try again.", code: "plan_empty", dropped: stats.dropped },
        502
      );
    }

    if (body.replaceDrafts) {
      const { error } = await deps.userClient
        .from("social_posts")
        .update({ status: "canceled", error_code: "replaced", error: "Replaced by a newer plan" })
        .eq("merchant_id", merchant.id)
        .eq("status", "draft");
      assertNoDbError(error, "Replace drafts", { route: ROUTE, merchantId: merchant.id });
    }

    const { data: plan, error: planErr } = await deps.userClient
      .from("social_plans")
      .insert({ merchant_id: merchant.id, horizon_days: body.horizonDays, raw_plan: posts.map((p) => p.post) })
      .select("id")
      .single();
    assertNoDbError(planErr, "Save plan", { route: ROUTE, merchantId: merchant.id });
    const planId = (plan as { id: string }).id;

    const { error: postsErr } = await deps.userClient.from("social_posts").insert(
      posts.map((p) => ({
        merchant_id: merchant.id,
        plan_id: planId,
        scheduled_for: p.post.scheduledFor,
        platforms: p.post.platforms,
        goal: p.post.goal,
        hook: p.post.hook,
        copies: p.copies,
        visual_brief: p.visualBrief,
        product_ids: p.productIds,
        media: p.media,
        status: "draft"
      }))
    );
    if (postsErr) {
      // Keep the database honest: no plan row without its posts.
      await deps.userClient.from("social_plans").delete().eq("id", planId);
      assertNoDbError(postsErr, "Save posts", { route: ROUTE, merchantId: merchant.id });
    }

    await finishRun({ status: "succeeded", plan_id: planId, post_count: posts.length, llm_calls: stats.llmCalls });
    return json(
      {
        ok: true,
        planId,
        count: posts.length,
        status: "draft",
        platforms,
        dropped: stats.dropped,
        instagramRemoved: stats.instagramRemoved,
        xShortened: stats.xShortened,
        llmCalls: stats.llmCalls
      },
      200
    );
  } catch (err) {
    await finishRun({
      status: "failed",
      error: redactSensitive(err instanceof Error ? err.message : String(err)).slice(0, 500)
    });
    throw err;
  }
}
