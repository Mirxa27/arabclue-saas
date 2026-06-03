import { describe, it, expect, afterEach } from "vitest";
import type { User } from "@supabase/supabase-js";
import { userIsPlatformAdmin, getPlatformAdminEmails } from "@/lib/auth/admin";

const asUser = (partial: Partial<User>): User => partial as User;
const original = process.env.PLATFORM_ADMIN_EMAILS;

afterEach(() => {
  if (original === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
  else process.env.PLATFORM_ADMIN_EMAILS = original;
});

describe("userIsPlatformAdmin", () => {
  it("allows an allow-listed email, case-insensitively", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "Owner@Arabclue.com, ops@arabclue.com";
    expect(userIsPlatformAdmin(asUser({ email: "owner@arabclue.com" }))).toBe(true);
    expect(userIsPlatformAdmin(asUser({ email: "OPS@ARABCLUE.COM" }))).toBe(true);
  });

  it("allows the platform_admin app_metadata role", () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    expect(
      userIsPlatformAdmin(asUser({ email: "eng@arabclue.com", app_metadata: { role: "platform_admin" } }))
    ).toBe(true);
  });

  it("denies non-admins, null users, and users without an email", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "owner@arabclue.com";
    expect(userIsPlatformAdmin(asUser({ email: "random@user.com" }))).toBe(false);
    expect(userIsPlatformAdmin(null)).toBe(false);
    expect(userIsPlatformAdmin(undefined)).toBe(false);
    expect(userIsPlatformAdmin(asUser({ app_metadata: { provider: "email" } }))).toBe(false);
  });

  it("parses the allow-list robustly (trims, drops blanks)", () => {
    process.env.PLATFORM_ADMIN_EMAILS = " a@b.com ,, c@d.com ,";
    expect(getPlatformAdminEmails()).toEqual(["a@b.com", "c@d.com"]);
  });
});
