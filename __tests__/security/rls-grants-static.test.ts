/**
 * critic-1 / critic-3 static guards over supabase/migrations (the behavioural proof is
 * supabase/tests/2x_*.test.sql via `npm run db:test`):
 *  - every table created in public enables RLS (events / wathq_cache never did);
 *  - tables and functions added from the lock-down on carry explicit grants in the same
 *    file, because Supabase's opt-in Data API grants give API roles nothing by default
 *    and legacy projects auto-grant anon/authenticated everything;
 *  - no merchant-facing table keeps a FOR ALL owner policy in the lock-down migration's
 *    scope (merchants, invoices, billing_payments, social_channels, voice_configs, ai_employees).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const DIR = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((name) => ({
    name,
    sql: readFileSync(join(DIR, name), "utf-8").replace(/--[^\n]*/g, "").toLowerCase()
  }));
const allSql = files.map((f) => f.sql).join("\n");
const LOCKDOWN = "20261106001000";

const bare = (t: string) => t.replace(/^public\./, "");

const createdTables = files.flatMap((f) =>
  [...f.sql.matchAll(/create table(?: if not exists)?\s+([a-z_.]+)\s*\(/g)].map((m) => ({ file: f.name, table: bare(m[1]) }))
);

describe("RLS on every table", () => {
  it("finds the tables", () => {
    expect(createdTables.map((t) => t.table)).toEqual(
      expect.arrayContaining(["merchants", "events", "wathq_cache", "webhook_events", "agent_settings", "support_tickets", "user_feedback"])
    );
  });

  it.each(createdTables.map((t) => [t.table, t.file] as const))("%s (created in %s) enables RLS", (table) => {
    expect(allSql).toMatch(new RegExp(`alter table\\s+(public\\.)?${table}\\s+enable row level security`));
  });
});

describe("explicit grants for objects added from the lock-down on", () => {
  const recent = files.filter((f) => f.name >= LOCKDOWN);

  it.each(
    recent.flatMap((f) =>
      [...f.sql.matchAll(/create table(?: if not exists)?\s+([a-z_.]+)\s*\(/g)].map((m) => [bare(m[1]), f.name, f.sql] as const)
    )
  )("table %s in %s revokes API roles and grants service_role", (table, _file, sql) => {
    expect(sql).toMatch(new RegExp(`revoke all on table\\s+public\\.${table}\\s+from anon, authenticated`));
    expect(sql).toMatch(new RegExp(`grant [a-z, ]+ on table\\s+public\\.${table}\\s+to service_role`));
  });

  it.each(
    recent.flatMap((f) =>
      [...f.sql.matchAll(/create or replace function\s+public\.([a-z_]+)\s*\(/g)].map((m) => [m[1], f.name, f.sql] as const)
    )
  )("function %s in %s is not executable by public/anon/authenticated", (fn, _file, sql) => {
    expect(sql).toMatch(new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`));
  });
});

describe("lock-down policies", () => {
  const lockdown = files.find((f) => f.name.startsWith(LOCKDOWN))!.sql;

  it.each(["merchants_self", "merchants_insert_self", "invoices_self", "billing_payments_self", "social_channels_self", "voice_configs_self", "employees: merchant owner"])(
    "drops the FOR ALL / INSERT owner policy %s",
    (policy) => {
      expect(lockdown).toContain(`drop policy if exists "${policy}"`);
    }
  );

  it("creates no FOR ALL policies", () => {
    expect(lockdown).not.toMatch(/create policy[^;]*for all/);
  });

  it("revokes table-level writes before granting columns", () => {
    const grants = files.find((f) => f.name.startsWith("20261106001100"))!.sql;
    expect(grants.indexOf("revoke all on table")).toBeLessThan(grants.indexOf("grant update (seller_name"));
    expect(grants).not.toMatch(/grant update \([^)]*\bplan\b[^)]*\) on public\.merchants/);
    expect(grants).not.toMatch(/grant (insert|update) \([^)]*\bphone_number\b[^)]*\) on public\.voice_configs/);
  });
});
