export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdminApi } from "@/lib/auth/admin";
import { testConnection, testAllConnections } from "@/lib/admin/connection-tests";
import { logConnectionTestBatch, logConnectionTestResult } from "@/lib/admin/connection-test-log";
import { TESTABLE_SERVICES } from "@/lib/admin/types";
import { handleRouteError } from "@/lib/api/route-handler";

const BodySchema = z.object({
  service: z.enum(TESTABLE_SERVICES).optional(),
  all: z.boolean().optional()
});

export async function POST(req: NextRequest) {
  try {
    const admin = await requirePlatformAdminApi();
    const body = BodySchema.parse(await req.json().catch(() => ({})));

    if (body.all) {
      const results = await testAllConnections();
      const passed = Object.values(results).filter((r) => r.ok).length;
      await logConnectionTestBatch(results, admin.email ?? undefined);
      return NextResponse.json({
        ok: passed === Object.keys(results).length,
        passed,
        total: Object.keys(results).length,
        results
      });
    }

    const service = body.service ?? "supabase";
    const result = await testConnection(service);
    await logConnectionTestResult({
      service,
      result,
      adminEmail: admin.email ?? undefined
    });
    return NextResponse.json({ service, ...result });
  } catch (err) {
    return handleRouteError(err);
  }
}
