import { NextRequest, NextResponse } from "next/server";
import { requireUserApi, getCurrentMerchant } from "@/lib/auth/session";
import { enrichCR } from "@/lib/wathq/client";
import { handleRouteError } from "@/lib/api/route-handler";
import { merchantCanUseFeature, featureGateMessage } from "@/lib/billing/entitlements";

export async function GET(_req: NextRequest, props: { params: Promise<{ cr: string }> }) {
  const params = await props.params;
  try {
    await requireUserApi();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });
    if (!merchantCanUseFeature(merchant, "wathq")) {
      return NextResponse.json({ error: featureGateMessage("wathq") }, { status: 402 });
    }

    const apiKey = process.env.WATHQ_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "wathq not configured" }, { status: 500 });
    if (!/^\d{10}$/.test(params.cr)) return NextResponse.json({ error: "invalid CR number" }, { status: 400 });

    const data = await enrichCR(params.cr, apiKey);
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    return handleRouteError(err);
  }
}
