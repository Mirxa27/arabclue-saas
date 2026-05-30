import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdminApi } from "@/lib/auth/admin";
import { getMerchantAdminDetail } from "@/lib/admin/stats";
import { handleRouteError, jsonError } from "@/lib/api/route-handler";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    await requirePlatformAdminApi();
    const { id } = await context.params;
    const merchant = await getMerchantAdminDetail(id);
    if (!merchant) return jsonError("merchant not found", 404);
    return NextResponse.json({ merchant });
  } catch (err) {
    return handleRouteError(err);
  }
}
