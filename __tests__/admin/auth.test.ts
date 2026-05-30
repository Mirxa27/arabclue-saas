import { describe, expect, it } from "vitest";
import { userIsPlatformAdmin } from "@/lib/auth/admin";
import type { User } from "@supabase/supabase-js";

function mockUser(email: string, role?: string): User {
  return {
    id: "u1",
    email,
    app_metadata: role ? { role } : {},
    user_metadata: {},
    aud: "authenticated",
    created_at: ""
  } as User;
}

describe("platform admin auth", () => {
  it("allows listed emails", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "ops@arabclue.com, admin@test.com";
    expect(userIsPlatformAdmin(mockUser("ops@arabclue.com"))).toBe(true);
    expect(userIsPlatformAdmin(mockUser("Admin@Test.com"))).toBe(true);
    expect(userIsPlatformAdmin(mockUser("other@test.com"))).toBe(false);
  });

  it("allows app_metadata platform_admin role", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "";
    expect(userIsPlatformAdmin(mockUser("x@test.com", "platform_admin"))).toBe(true);
  });
});
