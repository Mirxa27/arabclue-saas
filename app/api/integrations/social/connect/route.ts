import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi, getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { upsertSocialChannel } from "@/lib/oauth/channels";
import { getFeatureSettings } from "@/lib/admin/platform-settings";
import { merchantCanUseFeature, featureGateMessage } from "@/lib/billing/entitlements";

const BodySchema = z.object({
  platform: z.enum(["instagram", "tiktok", "x", "snapchat", "linkedin", "whatsapp"]),
  externalId: z.string().min(1),
  accessToken: z.string().min(10)
});

export async function POST(req: NextRequest) {
  try {
    await requireUserApi();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });

    const features = await getFeatureSettings();
    if (!features.socialOAuth) {
      return NextResponse.json({ error: "Social OAuth is disabled by platform admin" }, { status: 503 });
    }
    if (!merchantCanUseFeature(merchant, "social")) {
      return NextResponse.json({ error: featureGateMessage("social") }, { status: 402 });
    }

    const body = BodySchema.parse(await req.json());
    const supabase = await getServerSupabase();
    await upsertSocialChannel(supabase, merchant.id, body.platform, {
      externalId: body.externalId,
      accessToken: body.accessToken
    });

    return NextResponse.json({ ok: true, platform: body.platform });
  } catch (err) {
    return handleRouteError(err);
  }
}
