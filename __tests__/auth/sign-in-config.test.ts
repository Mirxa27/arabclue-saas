/**
 * RA-4 configuration: the optional SUPABASE_SECRET_KEY (only an sb_secret_… value is used, and
 * only by the sign-in client), its registration as an hPanel-only optional key, and the address
 * normalisation behind the per-address sign-in cap.
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authSecretKey } from "@/lib/db/supabase";
import { getSecretField, isBootstrapSecretKey, MANAGED_SECRET_KEYS } from "@/lib/admin/secret-registry";
import { normalizeEmailForThrottle, SIGN_IN_LIMITS } from "@/lib/auth/sign-in-limits";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authSecretKey", () => {
  it("uses only a new-style secret key", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "  sb_secret_abc123  ");
    expect(authSecretKey()).toBe("sb_secret_abc123");
    for (const ignored of ["", "   ", "sb_publishable_abc", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln"]) {
      vi.stubEnv("SUPABASE_SECRET_KEY", ignored);
      expect(authSecretKey()).toBeNull();
    }
  });

  it("is registered as an optional, hPanel-only key that is never stored in or hydrated from the DB", () => {
    const field = getSecretField("SUPABASE_SECRET_KEY");
    expect(field).toMatchObject({ required: false, type: "secret", bootstrap: true });
    expect(MANAGED_SECRET_KEYS).not.toContain("SUPABASE_SECRET_KEY");
    // Not a cold-start requirement: the app boots without it.
    expect(isBootstrapSecretKey("SUPABASE_SECRET_KEY")).toBe(false);
    expect(readFileSync(join(process.cwd(), ".env.example"), "utf8")).toMatch(/^SUPABASE_SECRET_KEY=$/m);
  });

  it("is only read by the sign-in client", () => {
    const root = process.cwd();
    const walk = (dir: string): string[] =>
      readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [join(dir, entry.name)] : []
      );
    const sources = [...walk("app"), ...walk("components"), ...walk("lib"), "middleware.ts", "instrumentation.ts"];
    const using = (needle: string) => sources.filter((file) => readFileSync(join(root, file), "utf8").includes(needle)).sort();
    expect(using("process.env.SUPABASE_SECRET_KEY")).toEqual(["lib/db/supabase.ts"]);
    expect(using("env.SUPABASE_SECRET_KEY")).toEqual(["lib/db/supabase.ts"]);
    expect(using("authSecretKey")).toEqual(["lib/db/supabase.ts"]);
    // …and inside it, only createRouteHandlerSupabase calls it (getServer/ServiceSupabase keep their keys).
    const supabaseModule = readFileSync(join(root, "lib/db/supabase.ts"), "utf8");
    expect(supabaseModule.match(/authSecretKey\(\);/g)).toHaveLength(1);
    expect(supabaseModule).toMatch(/createRouteHandlerSupabase[\s\S]*const secretKey = authSecretKey\(\);/);
  });
});

describe("normalizeEmailForThrottle", () => {
  it.each([
    ["Owner@Store.SA", "owner@store.sa"],
    [" owner+promo@store.sa ", "owner@store.sa"],
    ["o.w.n.e.r@gmail.com", "owner@gmail.com"],
    ["Owner+x@GoogleMail.com", "owner@gmail.com"],
    ["o.wner@store.sa", "o.wner@store.sa"], // dots only fold for Gmail
    ["+lead@store.sa", "+lead@store.sa"], // a leading "+" is not a tag
    ["not-an-email", "not-an-email"]
  ])("%s → %s", (input, expected) => {
    expect(normalizeEmailForThrottle(input)).toBe(expected);
  });

  it("caps per address below the per-IP cap", () => {
    expect(SIGN_IN_LIMITS.otpPerEmail.limit).toBe(3);
    expect(SIGN_IN_LIMITS.otpPerEmail.windowMs).toBe(15 * 60_000);
    expect(SIGN_IN_LIMITS.otpPerIp.limit).toBeGreaterThan(SIGN_IN_LIMITS.otpPerEmail.limit);
  });
});
