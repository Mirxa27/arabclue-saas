/**
 * UI-006 regression guard: every PostgREST upsert `onConflict` target in app/ and lib/
 * must be backed by a (non-partial) unique constraint or index in supabase/migrations.
 * Postgres rejects ON CONFLICT (cols) without one, which made "Save Brand Kit" fail on
 * every click. Partial unique indexes do not count: PostgREST cannot target them.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

type Target = { file: string; table: string; columns: string[] };

function codeTargets(): Target[] {
  const targets: Target[] = [];
  for (const file of [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))]) {
    const src = readFileSync(file, "utf-8");
    for (const m of src.matchAll(/\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g)) {
      const tail = src.slice(m.index! + m[0].length, m.index! + m[0].length + 800);
      const stmt = tail.slice(0, tail.indexOf(";") >= 0 ? tail.indexOf(";") : tail.length);
      const conflict = stmt.match(/onConflict:\s*["'`]([^"'`]+)["'`]/);
      if (!conflict) continue;
      targets.push({
        file: relative(ROOT, file),
        table: m[1],
        columns: conflict[1].split(",").map((c) => c.trim())
      });
    }
  }
  return targets;
}

/** Top-level comma split that respects parentheses. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim());
}

const cols = (list: string) => list.split(",").map((c) => c.trim().replace(/"/g, ""));

function uniqueKeys(): Map<string, string[][]> {
  const sql = readdirSync(join(ROOT, "supabase", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(ROOT, "supabase", "migrations", f), "utf-8"))
    .join("\n")
    .replace(/--[^\n]*/g, "")
    .toLowerCase();

  const keys = new Map<string, string[][]>();
  const add = (table: string, columns: string[]) => {
    const t = table.replace(/^public\./, "");
    keys.set(t, [...(keys.get(t) ?? []), columns]);
  };

  for (const m of sql.matchAll(/create table(?: if not exists)?\s+([a-z_.]+)\s*\(/g)) {
    // capture the balanced (...) body
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    while (depth > 0 && i < sql.length) {
      if (sql[i] === "(") depth++;
      if (sql[i] === ")") depth--;
      i++;
    }
    for (const part of splitTopLevel(sql.slice(start, i - 1))) {
      const tableKey = part.match(/^(?:constraint\s+\w+\s+)?(?:unique|primary key)\s*\(([^)]+)\)/);
      if (tableKey) {
        add(m[1], cols(tableKey[1]));
        continue;
      }
      const column = part.match(/^([a-z_]+)\s+.*\b(primary key|unique)\b/);
      if (column) add(m[1], [column[1]]);
    }
  }
  for (const m of sql.matchAll(/create unique index(?: if not exists)?\s+\w+\s+on\s+([a-z_.]+)\s*(?:using\s+\w+\s*)?\(([^)]+)\)([^;]*);/g)) {
    if (/\bwhere\b/.test(m[3])) continue; // partial: not usable as a PostgREST conflict target
    add(m[1], cols(m[2]));
  }
  for (const m of sql.matchAll(/alter table(?: only)?\s+([a-z_.]+)\s+add constraint\s+\w+\s+(?:unique|primary key)\s*\(([^)]+)\)/g)) {
    add(m[1], cols(m[2]));
  }
  return keys;
}

describe("upsert conflict targets match unique keys", () => {
  const targets = codeTargets();
  const keys = uniqueKeys();
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((c) => b.includes(c));

  it("finds the upserts it is meant to guard", () => {
    expect(targets.length).toBeGreaterThan(5);
    expect(targets.some((t) => t.table === "brand_kits")).toBe(true);
    expect(targets.some((t) => t.table === "agent_settings")).toBe(true);
  });

  it.each(codeTargets().map((t) => [`${t.table}(${t.columns.join(",")}) in ${t.file}`, t] as const))(
    "%s",
    (_label, target) => {
      const tableKeys = keys.get(target.table) ?? [];
      expect(
        tableKeys.some((k) => sameSet(k, target.columns)),
        `no unique constraint/index on ${target.table}(${target.columns.join(", ")}); known keys: ${JSON.stringify(tableKeys)}`
      ).toBe(true);
    }
  );

  it("does not accept a partial unique index as a conflict target", () => {
    // social_channels(platform, external_id) is unique only where external_id is not null
    const social = keys.get("social_channels") ?? [];
    expect(social.some((k) => sameSet(k, ["platform", "external_id"]))).toBe(false);
  });
});
