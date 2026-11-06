import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServiceSupabase } from "@/lib/db/supabase";
import { disconnectSocialChannel } from "@/lib/oauth/channels";
import { handleRouteError } from "@/lib/api/route-handler";

const BodySchema = z.object({
  platform: z.enum(["instagram", "tiktok", "x", "snapchat", "linkedin", "whatsapp"])
});

export async function POST(req: NextRequest) {
  try {
    const merchant = await requireMerchantApi();
    const body = BodySchema.parse(await req.json());
    // social_channels is not writable through the Data API; scoped to the session's merchant.
    await disconnectSocialChannel(getServiceSupabase(), merchant.id, body.platform);
    return NextResponse.json({ ok: true, platform: body.platform });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/integrations/social/disconnect" });
  }
}
