/**
 * Recording stand-in for a supabase-js client (query builder + rpc).
 *
 * Every terminal call (await / .single() / .maybeSingle()) records what was asked —
 * which client (label), table, operation, payload, options and filters — and resolves
 * with whatever the handler returns. Lets route/lib tests assert which client performed
 * a write (service role vs. the user's RLS-scoped session) and in which order.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

export type FakeOp = "select" | "insert" | "update" | "upsert" | "delete";

export type FakeCall = {
  client: string;
  table: string;
  op: FakeOp;
  payload?: unknown;
  options?: Record<string, unknown>;
  columns?: string;
  returning?: string;
  filters: Array<[string, string, unknown]>;
  single?: "single" | "maybeSingle";
};

export type FakeResult = {
  data?: unknown;
  error?: { code?: string; message?: string; details?: string } | null;
  count?: number | null;
};

export type FakeHandler = (call: FakeCall) => FakeResult | undefined | void;
export type FakeRpcHandler = (fn: string, args: Record<string, unknown>) => FakeResult | undefined | void;

const FILTERS = ["eq", "neq", "is", "in", "lt", "lte", "gt", "gte", "like", "ilike", "or", "not", "match", "contains", "filter"];
const MODIFIERS = ["order", "limit", "range", "abortSignal", "returns"];

export function createFakeSupabase(label: string, handler: FakeHandler = () => undefined, rpcHandler?: FakeRpcHandler) {
  const calls: FakeCall[] = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  const settle = (call: FakeCall) => {
    calls.push(call);
    const result = handler(call) ?? {};
    return Promise.resolve({ data: result.data ?? null, error: result.error ?? null, count: result.count ?? null });
  };

  function from(table: string) {
    const call: FakeCall = { client: label, table, op: "select", filters: [] };
    const builder: Record<string, unknown> = {};
    const chain =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        fn(...args);
        return builder;
      };

    builder.select = chain((columns?: string) => {
      if (call.op === "select") call.columns = columns ?? "*";
      else call.returning = columns ?? "*";
    });
    builder.insert = chain((payload: unknown, options?: Record<string, unknown>) => {
      call.op = "insert";
      call.payload = payload;
      call.options = options;
    });
    builder.update = chain((payload: unknown, options?: Record<string, unknown>) => {
      call.op = "update";
      call.payload = payload;
      call.options = options;
    });
    builder.upsert = chain((payload: unknown, options?: Record<string, unknown>) => {
      call.op = "upsert";
      call.payload = payload;
      call.options = options;
    });
    builder.delete = chain((options?: Record<string, unknown>) => {
      call.op = "delete";
      call.options = options;
    });
    for (const name of FILTERS) {
      builder[name] = chain((column: string, value?: unknown) => {
        call.filters.push([name, column, value]);
      });
    }
    for (const name of MODIFIERS) builder[name] = chain(() => undefined);
    builder.single = () => {
      call.single = "single";
      return settle(call);
    };
    builder.maybeSingle = () => {
      call.single = "maybeSingle";
      return settle(call);
    };
    builder.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      settle(call).then(onFulfilled, onRejected);
    return builder;
  }

  const client = {
    from,
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      rpcCalls.push({ fn, args });
      const result = rpcHandler?.(fn, args) ?? {};
      return { data: result.data ?? null, error: result.error ?? null };
    }
  };

  return {
    client: client as unknown as SupabaseClient,
    calls,
    rpcCalls,
    writes: () => calls.filter((c) => c.op !== "select"),
    filter: (call: FakeCall, column: string) => call.filters.find(([, c]) => c === column)?.[2]
  };
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>;

/** Request helper for route tests. */
export function jsonRequest(url: string, body: unknown, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(url, {
    method: init.method ?? "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10", ...(init.headers ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
