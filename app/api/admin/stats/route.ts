export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requirePlatformAdminApi } from "@/lib/auth/admin";
import { getPlatformStats } from "@/lib/admin/stats";
import { handleRouteError } from "@/lib/api/route-handler";

export async function GET() {
  try {
    await requirePlatformAdminApi();
    const stats = await getPlatformStats();
    return NextResponse.json(stats);
  } catch (err) {
    return handleRouteError(err);
  }
}
