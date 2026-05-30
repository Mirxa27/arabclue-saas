import { getServiceSupabase } from "@/lib/db/supabase";
import type { ConnectionTestResult, TestableService } from "@/lib/admin/types";

export async function logConnectionTestResult(opts: {
  service: TestableService;
  result: ConnectionTestResult;
  adminEmail?: string;
  batchId?: string;
}) {
  try {
    const supabase = getServiceSupabase();
    await supabase.from("events").insert({
      kind: "admin.connection_test",
      merchant: null,
      payload: {
        service: opts.service,
        ok: opts.result.ok,
        message: opts.result.message,
        latencyMs: opts.result.latencyMs ?? null,
        detail: opts.result.detail ?? null,
        adminEmail: opts.adminEmail ?? null,
        batchId: opts.batchId ?? null,
        at: new Date().toISOString()
      }
    });
  } catch {
    // Logging must not break connection tests.
  }
}

export async function logConnectionTestBatch(
  results: Record<TestableService, ConnectionTestResult>,
  adminEmail?: string
) {
  const batchId = crypto.randomUUID();
  await Promise.all(
    Object.entries(results).map(([service, result]) =>
      logConnectionTestResult({
        service: service as TestableService,
        result,
        adminEmail,
        batchId
      })
    )
  );
  return batchId;
}
