import { describe, expect, it } from "vitest";
import { loginPath, safeRedirectPath } from "@/lib/auth/redirect";

describe("safeRedirectPath", () => {
  it("keeps same-origin paths with query and hash", () => {
    expect(safeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("/integrations?connected=x#salla")).toBe("/integrations?connected=x#salla");
    expect(safeRedirectPath("/api/oauth/meta/start?target=whatsapp")).toBe("/api/oauth/meta/start?target=whatsapp");
    expect(safeRedirectPath("/employees/1?tab=integrations&q=sales%20rep")).toBe(
      "/employees/1?tab=integrations&q=sales%20rep"
    );
  });

  it("normalises dot segments without leaving the origin", () => {
    expect(safeRedirectPath("/./dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("/../../etc")).toBe("/etc");
  });

  it.each([
    ["absolute https URL", "https://evil.example"],
    ["absolute http URL", "http://evil.example/dashboard"],
    ["protocol-relative", "//evil.example"],
    ["protocol-relative with path", "//evil.example/dashboard"],
    ["slash-backslash", "/\\evil.example"],
    ["double backslash", "\\\\evil.example"],
    ["backslash in path", "/foo\\bar"],
    ["encoded double slash (no leading slash)", "%2F%2Fevil.example"],
    ["encoded double slash after slash", "/%2F%2Fevil.example"],
    ["encoded slash makes //", "/%2Fevil.example"],
    ["double-encoded slashes", "/%252F%252Fevil.example"],
    ["encoded backslash", "/%5Cevil.example"],
    ["tab trick", "/\t/evil.example"],
    ["newline trick", "/\n/evil.example"],
    ["encoded tab", "/%09/evil.example"],
    ["NUL byte", "/dash%00board"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,hi"],
    ["relative without slash", "dashboard"],
    ["leading space", " /dashboard"],
    ["malformed escape", "/%E0%A4%A"],
    ["empty", ""]
  ])("rejects %s", (_label, value) => {
    expect(safeRedirectPath(value)).toBeNull();
  });

  it("rejects null, undefined and oversized values", () => {
    expect(safeRedirectPath(null)).toBeNull();
    expect(safeRedirectPath(undefined)).toBeNull();
    expect(safeRedirectPath(`/${"a".repeat(2048)}`)).toBeNull();
  });

  it("rejects targets that loop back into the sign-in flow", () => {
    for (const p of ["/login", "/login?next=/x", "/signup", "/auth/callback?code=1", "/auth/confirm", "/api/auth/otp", "/auth"]) {
      expect(safeRedirectPath(p)).toBeNull();
    }
    // Only exact segments are treated as sign-in paths.
    expect(safeRedirectPath("/loginhelp")).toBe("/loginhelp");
  });
});

describe("loginPath", () => {
  it("adds a stable error and a validated next", () => {
    expect(loginPath({ error: "link_expired", next: "/integrations" })).toBe(
      "/login?error=link_expired&next=%2Fintegrations"
    );
  });

  it("drops unsafe or default next values", () => {
    expect(loginPath({ next: "//evil.example" })).toBe("/login");
    expect(loginPath({ next: "/dashboard" })).toBe("/login");
    expect(loginPath()).toBe("/login");
  });
});
