import { NextRequest, NextResponse } from "next/server";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { formatZodIssues, handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { markNotificationsSeen, MarkSeenBodySchema } from "@/lib/notifications/read-state";

export const dynamic = "force-dynamic";

/**
 * Mark the merchant's notifications as read up to `up_to` (ISO time; default now). The cursor
 * only moves forward and never past now. Returns { ok, last_seen_at }.
 */
export async function POST(req: NextRequest) {
  try {
    const merchant = await requireMerchantApi();
    const limited = await enforceRateLimit(req, "notifications:read", 60, 60_000, { identity: merchant.id });
    if (limited instanceof NextResponse) return limited;

    const raw = await req.text();
    let json: unknown = {};
    if (raw.trim()) {
      try {
        json = JSON.parse(raw);
      } catch {
        return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
      }
    }
    const parsed = MarkSeenBodySchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: formatZodIssues(parsed.error) }, { status: 400 });

    const lastSeenAt = await markNotificationsSeen(await getServerSupabase(), merchant.id, parsed.data.up_to ?? null);
    return NextResponse.json({ ok: true, last_seen_at: lastSeenAt });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/notifications/read" });
  }
}
