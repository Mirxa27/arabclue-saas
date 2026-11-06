export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdminApi } from "@/lib/auth/admin";
import { listEventsAdminFiltered } from "@/lib/admin/stats";
import { handleRouteError } from "@/lib/api/route-handler";
import { z } from "zod";

const QuerySchema = z.object({
  kind: z.string().max(100).optional(),
  merchant: z.string().max(100).optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional()
});

export async function GET(req: NextRequest) {
  try {
    await requirePlatformAdminApi();
    const sp = req.nextUrl.searchParams;
    const query = QuerySchema.parse({
      kind: sp.get("kind") ?? undefined,
      merchant: sp.get("merchant") ?? undefined,
      search: sp.get("search") ?? undefined,
      limit: sp.get("limit") ?? undefined,
      offset: sp.get("offset") ?? undefined
    });
    const result = await listEventsAdminFiltered(query);
    return NextResponse.json(result);
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/admin/events" });
  }
}
