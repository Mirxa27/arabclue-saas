/**
 * Chainable stand-in for the supabase-js query builder: every builder method records its
 * arguments and returns the chain; awaiting the chain (or calling maybeSingle/single)
 * resolves to the result scripted for that table.
 */
export type QueryResult = { data?: unknown; error?: { code?: string; message: string } | null };
export type QueryCall = { table: string; method: string; args: unknown[] };

const BUILDER_METHODS = ["select", "eq", "neq", "in", "order", "limit", "update", "upsert", "insert", "delete"];

export function fakeSupabase(results: Record<string, QueryResult | (() => QueryResult)>) {
  const calls: QueryCall[] = [];
  const resolve = (table: string): QueryResult => {
    const r = results[table];
    return (typeof r === "function" ? r() : r) ?? { data: null, error: null };
  };
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of BUILDER_METHODS) {
        chain[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return chain;
        };
      }
      chain.maybeSingle = () => {
        calls.push({ table, method: "maybeSingle", args: [] });
        return Promise.resolve(resolve(table));
      };
      chain.single = chain.maybeSingle;
      chain.then = (onFulfilled: (v: QueryResult) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(table)).then(onFulfilled, onRejected);
      return chain;
    }
  };
  return { client, calls };
}
