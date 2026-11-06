/**
 * RA-3 / RA-9 — the signed-in owner reads merchants through an explicit, secret-free column list.
 *
 * supabase/migrations/20261106007000_merchants_client_columns.sql replaces the table-wide SELECT
 * grant with column grants; lib/merchant/columns.ts is the list every user-scoped read uses.
 * The two must match exactly, never include a credential, and no browser/user-session code may
 * fall back to `select("*")` on merchants (that now fails with 42501 — and used to ship the Salla
 * tokens and the ZATCA CSID to every dashboard page).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MERCHANT_CLIENT_COLUMNS, MERCHANT_CLIENT_COLUMN_LIST, MERCHANT_SECRET_COLUMNS } from "@/lib/merchant/columns";

const ROOT = path.resolve(__dirname, "../..");
const MIGRATION = path.join(ROOT, "supabase/migrations/20261106007000_merchants_client_columns.sql");

function grantedColumns(sql: string): string[] {
  const m = /grant\s+select\s*\(([^)]*)\)\s*on\s+public\.merchants\s+to\s+authenticated/i.exec(sql);
  if (!m) throw new Error("no column grant for authenticated on public.merchants");
  return m[1]
    .split(",")
    .map((c) => c.replace(/--.*$/gm, "").trim())
    .filter(Boolean);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("merchants client columns", () => {
  it("lib/merchant/columns.ts and the migration grant exactly the same columns", () => {
    const granted = grantedColumns(readFileSync(MIGRATION, "utf8"));
    expect([...granted].sort()).toEqual([...MERCHANT_CLIENT_COLUMN_LIST].sort());
    expect(MERCHANT_CLIENT_COLUMNS.split(",").map((c) => c.trim())).toEqual([...MERCHANT_CLIENT_COLUMN_LIST]);
  });

  it("never lists a credential or token-layer column", () => {
    for (const secret of ["access_token", "refresh_token", "salla_state", "salla_refresh_lease", "salla_refresh_lease_until", "zatca_csid", "zatca_private_key_encrypted"]) {
      expect(MERCHANT_SECRET_COLUMNS).toContain(secret);
      expect(MERCHANT_CLIENT_COLUMN_LIST).not.toContain(secret);
    }
    expect(MERCHANT_CLIENT_COLUMNS).not.toContain("*");
  });

  it("keeps the columns RLS policies of other tables need (id, owner_user_id)", () => {
    expect(MERCHANT_CLIENT_COLUMN_LIST).toEqual(expect.arrayContaining(["id", "owner_user_id"]));
  });
});

describe("no user-scoped select('*') on merchants", () => {
  const files = ["app", "components", "hooks", "lib"].flatMap((d) => sourceFiles(path.join(ROOT, d)));
  const selectAll = /from\(\s*["']merchants["']\s*\)\s*\.select\(\s*(?:["']\*["'])?\s*\)/;

  it("browser code ('use client') never reads merchants with select('*')", () => {
    const offenders = files.filter((f) => {
      const text = readFileSync(f, "utf8");
      return /^\s*["']use client["']/m.test(text.slice(0, 200)) && selectAll.test(text);
    });
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("only service-role code still selects every merchants column", () => {
    const offenders = files.filter((f) => selectAll.test(readFileSync(f, "utf8")));
    for (const f of offenders) {
      const text = readFileSync(f, "utf8");
      expect(text, path.relative(ROOT, f)).toMatch(/getServiceSupabase/);
      expect(text, path.relative(ROOT, f)).not.toMatch(/getServerSupabase|getBrowserSupabase/);
    }
  });

  it("the merchant hooks/session helpers use the shared column list", () => {
    for (const rel of ["hooks/use-merchant.ts", "lib/auth/session.ts"]) {
      const text = readFileSync(path.join(ROOT, rel), "utf8");
      expect(text, rel).toMatch(/MERCHANT_CLIENT_COLUMNS/);
      expect(text, rel).not.toMatch(selectAll);
    }
  });
});
