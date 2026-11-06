export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requirePlatformAdminApi } from "@/lib/auth/admin";
import { listMerchantsAdmin } from "@/lib/admin/stats";
import { handleRouteError } from "@/lib/api/route-handler";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  q: z.string().max(200).optional()
});

export async function GET(req: NextRequest) {
  try {
    await requirePlatformAdminApi();
    const sp = req.nextUrl.searchParams;
    const query = QuerySchema.parse({
      limit: sp.get("limit") ?? undefined,
      offset: sp.get("offset") ?? undefined,
      q: sp.get("q") ?? undefined
    });
    return NextResponse.json(await listMerchantsAdmin(query));
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/admin/merchants" });
  }
}
