import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { HttpError } from "@/lib/api/errors";
import { CURRENT_DPA_VERSION } from "@/lib/legal/dpa";
import { isSameOriginRequest } from "@/lib/security/same-origin";

export const dynamic = "force-dynamic";

const BodySchema = z.strictObject({ accept: z.literal(true), version: z.literal(CURRENT_DPA_VERSION) });

/** Record the signed-in merchant's acceptance of the current DPA version. */
export async function POST(req: NextRequest) {
  try {
    if (!isSameOriginRequest(req)) throw new HttpError(403, "Cross-site request rejected", "cross_site");
    const merchant = await requireMerchantApi();
    BodySchema.parse(await req.json());
    const supabase = await getServerSupabase();
    const { error } = await supabase
      .from("merchants")
      .update({ dpa_accepted_at: new Date().toISOString(), dpa_version: CURRENT_DPA_VERSION })
      .eq("id", merchant.id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, version: CURRENT_DPA_VERSION });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/merchant/dpa" });
  }
}
