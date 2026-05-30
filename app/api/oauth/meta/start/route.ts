export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireUser, getCurrentMerchant } from "@/lib/auth/session";
import { createOAuthState } from "@/lib/oauth/state";
import { buildMetaAuthorizeURL, type MetaOAuthTarget } from "@/lib/meta/oauth";
import { handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function GET(req: NextRequest) {
  try {
    const limited = await enforceRateLimit(req, "oauth:start", 20, 60_000);
    if (limited instanceof NextResponse) return limited;

    await requireUser();
    const merchant = await getCurrentMerchant();
    if (!merchant) {
      return NextResponse.redirect(new URL("/welcome", req.url));
    }

    const target = (new URL(req.url).searchParams.get("target") ?? "instagram") as MetaOAuthTarget;
    if (target !== "instagram" && target !== "whatsapp") {
      return NextResponse.json({ error: "invalid target" }, { status: 400 });
    }

    const appId = process.env.META_APP_ID;
    if (!appId) return NextResponse.json({ error: "META_APP_ID not configured" }, { status: 503 });

    const platform = target === "whatsapp" ? "whatsapp" : "instagram";
    const state = createOAuthState({ merchantId: merchant.id, platform });
    const url = buildMetaAuthorizeURL({ appId, state, target });
    return NextResponse.redirect(url);
  } catch (err) {
    return handleRouteError(err);
  }
}
