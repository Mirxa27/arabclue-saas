import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/db/supabase";
import { processSocialInbound } from "@/lib/social/handover";
import { handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const BodySchema = z.object({
  merchantId: z.string().uuid(),
  platform: z.enum(["instagram", "tiktok", "x", "snapchat", "linkedin", "whatsapp"]),
  kind: z.enum(["dm", "comment", "mention"]).default("dm"),
  from: z.string().min(1),
  text: z.string().min(1)
});

/**
 * Normalized inbound social message → engager agent → optional human escalation event.
 * Auth: shared secret (bridge / internal automation).
 */
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.SOCIAL_INBOUND_SECRET ?? process.env.CRON_SECRET;
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return new NextResponse("unauthorized", { status: 401 });
    }

    const limited = await enforceRateLimit(req, "social:inbound", 120, 60_000);
    if (limited instanceof NextResponse) return limited;

    const body = BodySchema.parse(await req.json());
    const supabase = getServiceSupabase();
    const result = await processSocialInbound(supabase, {
      merchantId: body.merchantId,
      platform: body.platform,
      kind: body.kind,
      from: body.from,
      text: body.text
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
