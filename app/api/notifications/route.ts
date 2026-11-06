import { NextResponse } from "next/server";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase, getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { loadNotifications } from "@/lib/notifications/feed";

export const dynamic = "force-dynamic";

/**
 * The topbar bell's feed: { items, unread_count, last_seen_at } — escalations, failed posts,
 * ZATCA rejections, new voice bookings and billing problems of the signed-in merchant.
 * 401 signed out · 403 without a merchant.
 */
export async function GET() {
  try {
    const merchant = await requireMerchantApi();
    const feed = await loadNotifications({
      merchant,
      userClient: await getServerSupabase(),
      serviceClient: getServiceSupabase()
    });
    return NextResponse.json(feed, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/notifications" });
  }
}
