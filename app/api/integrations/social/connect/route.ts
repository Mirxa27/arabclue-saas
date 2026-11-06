/**
 * POST /api/integrations/social/connect — connect a channel with a pasted access token
 * (fallback for merchants who cannot use the OAuth buttons).
 *
 * The account id (social_channels.external_id, used to route inbound webhooks) is
 * derived from the provider with the token; any `externalId` the client sends is
 * ignored. An account already connected to another store is refused (409). Written
 * on the service role: social_channels is not writable through the Data API.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { upsertSocialChannel } from "@/lib/oauth/channels";
import { resolveChannelExternalId } from "@/lib/oauth/channel-identity";
import { getFeatureSettings } from "@/lib/admin/platform-settings";
import { merchantCanUseFeature, featureGateMessage } from "@/lib/billing/entitlements";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { updateAgentStatus } from "@/lib/agents/store-server";
import { reportError } from "@/lib/observability/error-reporter";

const ROUTE = "POST /api/integrations/social/connect";

const BodySchema = z.object({
  platform: z.enum(["instagram", "tiktok", "x", "snapchat", "linkedin", "whatsapp"]),
  accessToken: z.string().trim().min(10).max(4096),
  /** Ignored — accepted only so older clients keep working; the id comes from the provider. */
  externalId: z.string().max(200).optional()
});

export async function POST(req: NextRequest) {
  try {
    const merchant = await requireMerchantApi();

    const features = await getFeatureSettings();
    if (!features.socialOAuth) {
      return NextResponse.json({ error: "Social OAuth is disabled by platform admin" }, { status: 503 });
    }
    if (!merchantCanUseFeature(merchant, "social")) {
      return NextResponse.json({ error: featureGateMessage("social") }, { status: 402 });
    }

    const limited = await enforceRateLimit(req, "social:manual-connect", 10, 10 * 60_000, merchant.id);
    if (limited instanceof NextResponse) return limited;

    const body = BodySchema.parse(await req.json());
    const externalId = await resolveChannelExternalId(body.platform, body.accessToken);

    await upsertSocialChannel(getServiceSupabase(), merchant.id, body.platform, {
      externalId,
      accessToken: body.accessToken
    });

    try {
      await updateAgentStatus(merchant.id, "social", true);
    } catch (err) {
      reportError(err, { route: ROUTE, merchantId: merchant.id, extra: { step: "enable social agent" } });
    }

    return NextResponse.json({ ok: true, platform: body.platform, externalId });
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
