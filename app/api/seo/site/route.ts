import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { formatZodIssues, handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { saveStoreUrl } from "@/lib/seo/site";
import { STORE_URL_MAX } from "@/lib/seo/store-url";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ store_url: z.string().max(STORE_URL_MAX) });

/** Save the store URL the SEO audit checks (https, public host). Returns { store_url }. */
export async function PUT(req: NextRequest) {
  try {
    const merchant = await requireMerchantApi();
    const limited = await enforceRateLimit(req, "seo:site", 20, 10 * 60_000, { identity: merchant.id });
    if (limited instanceof NextResponse) return limited;

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: formatZodIssues(parsed.error) }, { status: 400 });

    const storeUrl = await saveStoreUrl(await getServerSupabase(), merchant.id, parsed.data.store_url);
    return NextResponse.json({ store_url: storeUrl });
  } catch (err) {
    return handleRouteError(err, { route: "PUT /api/seo/site" });
  }
}
