/**
 * Shared fakes for webhook route tests.
 *
 *  - createClaimDb(): a recording service-role client (createFakeSupabase) whose
 *    `claim_webhook_event` RPC follows the SQL state machine proven by
 *    supabase/tests/10_webhook_claims.test.sql, and whose webhook_events updates
 *    (complete / release) move that state — so a replay of a processed event is a
 *    real "duplicate".
 *  - runAfterTasks(): drains the callbacks a route scheduled with next/server
 *    `after()` (tests replace `after` with a collector — the real one throws outside
 *    a request scope).
 */
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeResult } from "./fake-supabase";

export type ClaimStatus = "processing" | "done" | "failed";

export function createClaimDb(
  tableHandler: (call: FakeCall) => FakeResult | undefined | void = () => undefined,
  opts: { failClaimsAfter?: number } = {}
) {
  const claims = new Map<string, ClaimStatus>();
  let claimCalls = 0;

  const fake = createFakeSupabase(
    "service",
    (call) => {
      if (call.table === "webhook_events" && call.op === "update") {
        const provider = call.filters.find(([, c]) => c === "provider")?.[2];
        const eventId = call.filters.find(([, c]) => c === "event_id")?.[2];
        const status = (call.payload as { status?: string } | undefined)?.status;
        if ((status === "done" || status === "failed") && typeof provider === "string" && typeof eventId === "string") {
          claims.set(`${provider}:${eventId}`, status);
        }
        return { data: null, error: null };
      }
      return tableHandler(call);
    },
    (fn, args) => {
      if (fn !== "claim_webhook_event") return { error: { code: "PGRST202", message: `unknown function ${fn}` } };
      claimCalls += 1;
      if (opts.failClaimsAfter !== undefined && claimCalls > opts.failClaimsAfter) {
        return { error: { code: "08006", message: "connection failure" } };
      }
      const key = `${String(args.p_provider)}:${String(args.p_event_id)}`;
      const current = claims.get(key);
      if (!current) {
        claims.set(key, "processing");
        return { data: "new" };
      }
      if (current === "failed") {
        claims.set(key, "processing");
        return { data: "retry" };
      }
      return { data: current === "done" ? "duplicate" : "in_progress" };
    }
  );

  return {
    ...fake,
    claims,
    claimCalls: () => claimCalls,
    /** Every write except claim bookkeeping (webhook_events). */
    appWrites: () => fake.calls.filter((c) => c.op !== "select" && c.table !== "webhook_events")
  };
}

export type ClaimDb = ReturnType<typeof createClaimDb>;

export type AfterTask = () => unknown;

export async function runAfterTasks(tasks: AfterTask[]): Promise<void> {
  while (tasks.length) {
    const task = tasks.shift();
    if (task) await task();
  }
}

/** A raw-body POST (the exact bytes matter for signatures). */
export function rawPost(url: string, body: string | Buffer, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.20", ...headers },
    body: typeof body === "string" ? body : new Uint8Array(body)
  });
}

export const EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
