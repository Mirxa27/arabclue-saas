import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

/**
 * Merchant isolation is enforced at the database by Row Level Security. This
 * test guards against a migration regression that silently drops RLS on a
 * merchant-owned table (which would expose merchant A's data to merchant B).
 */
const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

const allSql = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf-8"))
  .join("\n")
  .toLowerCase();

const MERCHANT_OWNED_TABLES = [
  "merchants",
  "brand_kits",
  "invoices",
  "social_plans",
  "social_posts",
  "voice_configs",
  "bookings",
  "seo_content",
  "billing_payments",
  "ai_employees",
  "ai_employee_integrations",
  "ai_employee_conversations",
  "ai_employee_messages",
  "ai_employee_tasks",
  "ai_employee_actions"
];

describe("merchant-owned tables enforce Row Level Security", () => {
  it.each(MERCHANT_OWNED_TABLES)("enables RLS on %s", (table) => {
    expect(allSql).toMatch(new RegExp(`alter table\\s+${table}\\s+enable row level security`));
  });

  it("defines at least one merchant-scoped policy", () => {
    expect(allSql).toMatch(/create policy[\s\S]*?merchant_id/);
  });
});
