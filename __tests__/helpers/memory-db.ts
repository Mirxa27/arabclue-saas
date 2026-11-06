/**
 * Tiny in-memory table store behind createFakeSupabase: inserts get an id and are kept,
 * selects/updates/deletes honour eq / neq / in / is(null) / lte / gte filters (other filters
 * such as `or` are ignored), `.limit` is not applied. Enough for runtime / tick tests that need
 * a task created in one step to be read in the next.
 */
import { randomUUID } from "crypto";
import { createFakeSupabase, type FakeCall, type FakeResult, type FakeRpcHandler } from "./fake-supabase";

export type Row = Record<string, unknown>;

function matches(row: Row, filters: FakeCall["filters"]): boolean {
  for (const [op, col, value] of filters) {
    const v = row[col];
    switch (op) {
      case "eq":
        if (v !== value) return false;
        break;
      case "neq":
        if (v === value) return false;
        break;
      case "in":
        if (!(value as unknown[]).includes(v)) return false;
        break;
      case "is":
        if (value === null && v !== null && v !== undefined) return false;
        break;
      case "lte":
        if (v === null || v === undefined || String(v) > String(value)) return false;
        break;
      case "gte":
        if (v === null || v === undefined || String(v) < String(value)) return false;
        break;
      default:
        break;
    }
  }
  return true;
}

export function createMemoryDb(
  seed: Record<string, Row[]> = {},
  opts: { override?: (call: FakeCall, tables: Record<string, Row[]>) => FakeResult | undefined; rpc?: FakeRpcHandler } = {}
) {
  const tables: Record<string, Row[]> = {};
  for (const [t, rows] of Object.entries(seed)) tables[t] = rows.map((r) => ({ ...r }));
  const table = (name: string) => (tables[name] ??= []);

  const fake = createFakeSupabase(
    "service",
    (call) => {
      const forced = opts.override?.(call, tables);
      if (forced) return forced;
      const rows = table(call.table);
      switch (call.op) {
        case "insert": {
          const items = (Array.isArray(call.payload) ? call.payload : [call.payload]) as Row[];
          const created = items.map((p) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...p }));
          rows.push(...created);
          return { data: Array.isArray(call.payload) ? created : created[0] };
        }
        case "update": {
          const hit = rows.filter((r) => matches(r, call.filters));
          for (const r of hit) Object.assign(r, call.payload as Row);
          if (call.single) return { data: hit[0] ?? null };
          return { data: call.returning ? hit : null };
        }
        case "delete": {
          const keep = rows.filter((r) => !matches(r, call.filters));
          tables[call.table] = keep;
          return { data: null };
        }
        default: {
          const hit = rows.filter((r) => matches(r, call.filters));
          if (call.single) return { data: hit[0] ?? null };
          return { data: hit, count: hit.length };
        }
      }
    },
    opts.rpc
  );
  return { ...fake, tables, table };
}
