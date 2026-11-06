import { describe, expect, it } from "vitest";
import { loginPath, safeRedirectPath } from "@/lib/auth/redirect";
import { relativeRedirect } from "@/lib/http/redirect";

/** RA-1 / RA-5: inputs whose *normalised* form (dot segments removed) is protocol-relative. */
const DOT_SEGMENT_OFFSITE = [
  "/.//evil.example/x",
  "/.//other.example/x",
  "/%2e//evil.example",
  "/%2E//evil.example",
  "/..//evil.example",
  "/%2e%2e//evil.example",
  "/a/..//evil.example",
  "/a/%2e%2e//evil.example",
  "/x/.././/evil",
  "/x/.././/evil.example/phish?x=1#h",
  "/./%2F/evil.example",
  "/./%2f/evil.example",
  "/.//evil.example/phish"
];

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

  it.each(DOT_SEGMENT_OFFSITE)("rejects %s, whose normalised form would be protocol-relative", (value) => {
    expect(safeRedirectPath(value)).toBeNull();
  });

  it("only ever returns values that resolve on the current origin and that relativeRedirect accepts", () => {
    // Every combination of a dot-segment / encoded prefix, a separator and a host-looking tail.
    const prefixes = ["", "/", "/.", "/./", "/..", "/../", "/a/..", "/a/../", "/%2e", "/%2e/", "/%2E%2E", "/%2e%2e/", "/x/./", "/x/.././"];
    const separators = ["/", "//", "/%2F", "%2F", "%2F%2F", "/%5C", "\\", "/./", "/%2e/", "//./", "/.%2F/"];
    const tails = ["evil.example/x", "evil.example", "evil.example?q=1#h", "dashboard"];
    const base = "https://arabclue.example";
    let accepted = 0;
    for (const prefix of prefixes) {
      for (const sep of separators) {
        for (const tail of tails) {
          const input = `${prefix}${sep}${tail}`;
          const out = safeRedirectPath(input);
          if (out === null) continue;
          accepted += 1;
          expect(out.startsWith("/") && !out.startsWith("//"), `${input} → ${out}`).toBe(true);
          expect(new URL(out, base).origin, `${input} → ${out}`).toBe(base);
          // The value is safe to hand to a redirect after a token was consumed: it never throws.
          expect(() => relativeRedirect(out), `${input} → ${out}`).not.toThrow();
          // …and no decoding layer turns it into a protocol-relative reference either.
          expect(decodeURIComponent(out).startsWith("//"), `${input} → ${out}`).toBe(false);
        }
      }
    }
    expect(accepted).toBeGreaterThan(0); // sanity: ordinary paths like "/./dashboard" still pass
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
