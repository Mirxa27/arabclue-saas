export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { scheduler } from "@/lib/social/agent";
import { buildConnectorsForMerchant } from "@/lib/social/connectors";
import { getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { assertCronAuthorized } from "@/lib/security/cron";
import { getAgentSettings } from "@/lib/admin/platform-settings";
import type { ScheduledPost, SocialStore } from "@/lib/social/agent";
import type { SocialPostStatus } from "@/lib/types/database";

type SocialPostRow = {
  id: string;
  merchant_id: string;
  scheduled_for: string;
  platforms: string[];
  goal: string | null;
  hook: string | null;
  copies: Record<string, unknown>;
  visual_brief: Record<string, unknown> | null;
  status: SocialPostStatus;
};

function rowToScheduledPost(r: SocialPostRow): ScheduledPost {
  return {
    id: r.id,
    merchantId: r.merchant_id,
    post: {
      scheduledFor: r.scheduled_for,
      platforms: r.platforms as ScheduledPost["post"]["platforms"],
      goal: (r.goal ?? "awareness") as ScheduledPost["post"]["goal"],
      productIds: [],
      hook: r.hook ?? "",
      rationale: ""
    },
    copies: r.copies as ScheduledPost["copies"],
    visualBrief: r.visual_brief as ScheduledPost["visualBrief"],
    status: r.status === "canceled" ? "failed" : r.status
  };
}

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const denied = assertCronAuthorized(req);
    if (denied) return denied;

    const agents = await getAgentSettings();
    if (!agents.social.enabled) {
      return NextResponse.json({ ran: 0, results: [], skipped: "social agent disabled" });
    }

    const supabase = getServiceSupabase();
    const channelCache = new Map<string, ReturnType<typeof buildConnectorsForMerchant>>();

    async function connectorsForMerchant(merchantId: string) {
      if (channelCache.has(merchantId)) return channelCache.get(merchantId)!;
      const { data } = await supabase.from("social_channels").select("platform, external_id, access_token_encrypted").eq("merchant_id", merchantId);
      const connectors = buildConnectorsForMerchant(data ?? []);
      channelCache.set(merchantId, connectors);
      return connectors;
    }

    const store: SocialStore = {
      async upsertPost(p) {
        await supabase.from("social_posts").upsert({
          id: p.id,
          copies: p.copies,
          visual_brief: p.visualBrief,
          status: p.status,
          scheduled_for: p.post.scheduledFor,
          platforms: p.post.platforms,
          goal: p.post.goal,
          hook: p.post.hook
        });
      },
      async listDue(beforeISO) {
        const { data } = await supabase
          .from("social_posts")
          .select("*")
          .eq("status", "scheduled")
          .lte("scheduled_for", beforeISO)
          .limit(agents.social.maxPostsPerRun ?? 50);
        return ((data ?? []) as SocialPostRow[]).map(rowToScheduledPost);
      },
      async markPublished(id, when, remoteIds) {
        await supabase
          .from("social_posts")
          .update({
            status: "published",
            published_at: when,
            ...(remoteIds && Object.keys(remoteIds).length ? { remote_ids: remoteIds } : {})
          })
          .eq("id", id);
      },
      async markFailed(id, error) {
        await supabase.from("social_posts").update({ status: "failed", error }).eq("id", id);
      }
    };

    const results = await scheduler({ store, connectorsForMerchant });
    return NextResponse.json({ ran: results.length, results });
  } catch (err) {
    return handleRouteError(err);
  }
}
