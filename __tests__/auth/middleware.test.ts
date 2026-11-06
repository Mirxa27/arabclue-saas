import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ANON_KEY, SUPABASE_URL, fakeUser, json, stubGoTrue } from "../helpers/fake-gotrue";

const getUser = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser } }))
}));

import { middleware } from "@/middleware";

const SITE = "http://localhost:3111";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY);
  getUser.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("middleware", () => {
  it("lets /auth/* and /api/auth/* through without a session or a refresh", async () => {
    for (const path of ["/auth/callback?code=x", "/auth/confirm?token_hash=x&type=email", "/api/auth/otp"]) {
      const res = await middleware(new NextRequest(`${SITE}${path}`));
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
    expect(getUser).not.toHaveBeenCalled();
  });

  it("sends signed-out visitors of protected pages to /login with the full path as next", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await middleware(new NextRequest(`${SITE}/integrations/callback?platform=x&status=success`));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") as string);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/integrations/callback?platform=x&status=success");
  });

  it("redirects a signed-in user away from /login to a safe next only", async () => {
    getUser.mockResolvedValue({ data: { user: fakeUser() } });
    const safe = await middleware(new NextRequest(`${SITE}/login?next=%2Fbilling`));
    expect(new URL(safe.headers.get("location") as string).pathname).toBe("/billing");

    for (const evil of ["//evil.example", "/\\evil.example", "https://evil.example", "%2F%2Fevil.example"]) {
      const res = await middleware(new NextRequest(`${SITE}/login?next=${encodeURIComponent(evil)}`));
      const location = new URL(res.headers.get("location") as string);
      expect(location.origin).toBe(SITE);
      expect(location.pathname).toBe("/dashboard");
    }
  });

  // RA-1 / RA-5: dot-segment payloads normalise to "//host" and used to become a 307 off-site.
  it.each(["/login", "/signup"])("keeps a signed-in user on the site for dot-segment next values on %s", async (page) => {
    getUser.mockResolvedValue({ data: { user: fakeUser() } });
    for (const evil of [
      "/.//evil.example/phish",
      "/..//evil.example",
      "/%2e//evil.example",
      "/a/..//evil.example",
      "/x/.././/evil",
      "/./%2F/evil.example"
    ]) {
      for (const query of [`next=${encodeURIComponent(evil)}`, `next=${evil}`]) {
        const res = await middleware(new NextRequest(`${SITE}${page}?${query}`));
        expect(res.status).toBe(307);
        const location = new URL(res.headers.get("location") as string);
        expect(location.origin, `${page}?${query}`).toBe(SITE);
        expect(location.pathname, `${page}?${query}`).toBe("/dashboard");
      }
    }
  });
});

describe("middleware session refresh", () => {
  it("forwards refreshed cookies to the request and keeps them on redirects", async () => {
    // Use the real SSR client for this case: an expired access token is refreshed via GoTrue.
    vi.doUnmock("@supabase/ssr");
    vi.resetModules();
    const { middleware: realMiddleware } = await import("@/middleware");
    const { fakeSession } = await import("../helpers/fake-gotrue");

    const expired = fakeSession();
    expired.expires_at = Math.floor(Date.now() / 1000) - 60;
    const refreshed = fakeSession();
    stubGoTrue({
      "POST /auth/v1/token": () => json(200, refreshed),
      "GET /auth/v1/user": () => json(200, fakeUser())
    });
    const cookieValue = `base64-${Buffer.from(JSON.stringify(expired)).toString("base64url")}`;

    const res = await realMiddleware(
      new NextRequest(`${SITE}/login`, { headers: { cookie: `sb-abcdefgh-auth-token=${cookieValue}` } })
    );

    // Signed in → redirected away from /login, and the refreshed session cookie rides along.
    expect(new URL(res.headers.get("location") as string).pathname).toBe("/dashboard");
    const setCookie = res.headers.getSetCookie().join("\n");
    expect(setCookie).toContain("sb-abcdefgh-auth-token=base64-");

    // On a rendered page the refreshed token is also forwarded to the request the page sees,
    // so server components don't refresh again with the already-rotated refresh token.
    const page = await realMiddleware(
      new NextRequest(`${SITE}/pricing`, { headers: { cookie: `sb-abcdefgh-auth-token=${cookieValue}` } })
    );
    expect(page.headers.get("x-middleware-next")).toBe("1");
    const forwarded = page.headers.get("x-middleware-request-cookie") ?? "";
    expect(forwarded).toContain("sb-abcdefgh-auth-token=");
    expect(forwarded).not.toContain(cookieValue);
    expect(page.headers.getSetCookie().join("\n")).toContain("sb-abcdefgh-auth-token=base64-");
  });
});
