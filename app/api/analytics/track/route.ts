import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { trackServerEvent, shouldTrackAnalytics } from "@/lib/analytics/track";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { handleRouteError } from "@/lib/api/route-handler";

export const runtime = "nodejs";

const BodySchema = z.object({
  name: z.string().min(1).max(80).regex(/^[a-z0-9._-]+$/i),
  props: z.record(z.unknown()).optional(),
  sessionId: z.string().max(64).optional()
});

export async function POST(req: NextRequest) {
  try {
    const limited = await enforceRateLimit(req, "analytics", 120, 60_000);
    if (limited instanceof NextResponse) return limited;

    const dnt = req.headers.get("dnt");
    if (!shouldTrackAnalytics({ dntHeader: dnt })) {
      return NextResponse.json({ ok: true, skipped: "dnt" });
    }

    const body = BodySchema.parse(await req.json());
    await trackServerEvent(
      {
        name: body.name,
        props: body.props,
        sessionId: body.sessionId ?? null
      },
      dnt
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, { route: "/api/analytics/track" });
  }
}
