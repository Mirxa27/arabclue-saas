/**
 * POST /api/social/inbound — normalised inbound social message from internal
 * automation (bridge / ops tooling) → engager agent → optional human escalation.
 *
 * F05: authenticated with `Authorization: Bearer <secret>` where the secret is
 * SOCIAL_INBOUND_SECRET, or CRON_SECRET when that is blank (`||`: an empty
 * SOCIAL_INBOUND_SECRET= in .env must not disable the fallback). No secret at all:
 * 503. Compared in constant time.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/db/supabase";
import { readTextBody } from "@/lib/http/raw-body";
import { hasBearerSecret } from "@/lib/security/compare";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { processSocialInbound } from "@/lib/social/handover";

export const SOCIAL_INBOUND_ROUTE = "POST /api/social/inbound";
const MAX_BODY_BYTES = 64 * 1024;

export const SocialInboundBodySchema = z.object({
  merchantId: z.uuid(),
  platform: z.enum(["instagram", "tiktok", "x", "snapchat", "linkedin", "whatsapp"]),
  kind: z.enum(["dm", "comment", "mention"]).default("dm"),
  from: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(4000)
});

/** SOCIAL_INBOUND_SECRET, else CRON_SECRET — blank values count as unset. */
export function socialInboundSecret(): string | null {
  return process.env.SOCIAL_INBOUND_SECRET?.trim() || process.env.CRON_SECRET?.trim() || null;
}

export async function handleSocialInbound(req: NextRequest): Promise<NextResponse> {
  const secret = socialInboundSecret();
  if (!secret) {
    return NextResponse.json({ error: "social inbound not configured", code: "webhook_not_configured" }, { status: 503 });
  }
  if (!hasBearerSecret(req, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limited = await enforceRateLimit(req, "social:inbound", 120, 60_000);
  if (limited instanceof NextResponse) return limited;

  const raw = await readTextBody(req, MAX_BODY_BYTES);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const body = SocialInboundBodySchema.parse(json);

  const result = await processSocialInbound(getServiceSupabase(), {
    merchantId: body.merchantId,
    platform: body.platform,
    kind: body.kind,
    from: body.from,
    text: body.text
  });
  return NextResponse.json(result);
}
