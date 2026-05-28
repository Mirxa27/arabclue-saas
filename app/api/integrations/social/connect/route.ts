import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";

const BodySchema = z.object({
  platform: z.enum(["instagram", "tiktok", "x", "snapchat", "linkedin", "whatsapp"]),
  externalId: z.string().min(1),
  accessToken: z.string().min(10)
});

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });

    const body = BodySchema.parse(await req.json());
    const supabase = getServerSupabase();

    const { error } = await supabase.from("social_channels").upsert(
      {
        merchant_id: merchant.id,
        platform: body.platform,
        external_id: body.externalId,
        access_token_encrypted: body.accessToken,
        connected_at: new Date().toISOString()
      },
      { onConflict: "merchant_id,platform" }
    );

    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, platform: body.platform });
  } catch (err) {
    return handleRouteError(err);
  }
}
