export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requirePlatformAdminApi } from "@/lib/auth/admin";
import { listMerchantsAdmin } from "@/lib/admin/stats";
import { handleRouteError } from "@/lib/api/route-handler";

export async function GET() {
  try {
    await requirePlatformAdminApi();
    const merchants = await listMerchantsAdmin();
    return NextResponse.json({ merchants });
  } catch (err) {
    return handleRouteError(err);
  }
}
