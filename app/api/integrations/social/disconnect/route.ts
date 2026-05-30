import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi, getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { disconnectSocialChannel } from "@/lib/oauth/channels";
import { handleRouteError } from "@/lib/api/route-handler";

const BodySchema = z.object({
  platform: z.enum(["instagram", "tiktok", "x", "snapchat", "linkedin", "whatsapp"])
});

export async function POST(req: NextRequest) {
  try {
    await requireUserApi();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });

    const body = BodySchema.parse(await req.json());
    const supabase = getServerSupabase();
    await disconnectSocialChannel(supabase, merchant.id, body.platform);
    return NextResponse.json({ ok: true, platform: body.platform });
  } catch (err) {
    return handleRouteError(err);
  }
}
