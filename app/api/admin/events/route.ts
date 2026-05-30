export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdminApi } from "@/lib/auth/admin";
import { listEventsAdminFiltered } from "@/lib/admin/stats";
import { handleRouteError } from "@/lib/api/route-handler";

export async function GET(req: NextRequest) {
  try {
    await requirePlatformAdminApi();
    const sp = req.nextUrl.searchParams;
    const result = await listEventsAdminFiltered({
      kind: sp.get("kind") ?? undefined,
      merchant: sp.get("merchant") ?? undefined,
      search: sp.get("search") ?? undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
      offset: sp.get("offset") ? Number(sp.get("offset")) : undefined
    });
    return NextResponse.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
