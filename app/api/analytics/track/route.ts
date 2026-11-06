import { NextRequest, NextResponse } from "next/server";
import { trackServerEvent, shouldTrackAnalytics } from "@/lib/analytics/track";
import { AnalyticsBodySchema, ANALYTICS_MAX_BODY_BYTES } from "@/lib/analytics/schema";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { handleRouteError } from "@/lib/api/route-handler";
import { HttpError } from "@/lib/api/errors";
import { readTextBody } from "@/lib/http/raw-body";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const limited = await enforceRateLimit(req, "analytics", 120, 60_000);
    if (limited instanceof NextResponse) return limited;

    const dnt = req.headers.get("dnt");
    if (!shouldTrackAnalytics({ dntHeader: dnt })) {
      return NextResponse.json({ ok: true, skipped: "dnt" });
    }

    const raw = await readTextBody(req, ANALYTICS_MAX_BODY_BYTES);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "Body must be JSON", "invalid_json");
    }
    const body = AnalyticsBodySchema.parse(json);
    await trackServerEvent({ name: body.name, props: body.props, sessionId: body.sessionId ?? null }, dnt);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, { route: "/api/analytics/track" });
  }
}
