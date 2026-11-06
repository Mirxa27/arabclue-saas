/**
 * RA-1 / RA-5 defence in depth: whatever path the redirect helper hands the middleware, the
 * middleware never answers with an off-site Location. The helper is mocked here to return
 * values it must never produce (protocol-relative / absolute), so this test pins the
 * middleware's own origin check independently of lib/auth/redirect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ANON_KEY, SUPABASE_URL, fakeUser } from "../helpers/fake-gotrue";

const getUser = vi.hoisted(() => vi.fn());
const forced = vi.hoisted(() => ({ value: "//evil.example/x" as string | null }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser } }))
}));
vi.mock("@/lib/auth/redirect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/redirect")>()),
  safeRedirectPath: vi.fn(() => forced.value)
}));

import { middleware } from "@/middleware";

const SITE = "http://localhost:3111";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY);
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: fakeUser() } });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("middleware redirect origin guard", () => {
  it.each(["//evil.example/x", "https://evil.example/x", "http://localhost:3112/x", "//localhost:3111.evil.example"])(
    "falls back to /dashboard on this origin when the target would be %s",
    async (value) => {
      forced.value = value;
      for (const page of ["/login", "/signup"]) {
        const res = await middleware(new NextRequest(`${SITE}${page}?next=anything`));
        expect(res.status).toBe(307);
        const location = new URL(res.headers.get("location") as string);
        expect(location.origin).toBe(SITE);
        expect(location.pathname).toBe("/dashboard");
      }
    }
  );

  it("still follows a same-origin path", async () => {
    forced.value = "/billing?plan=pro";
    const res = await middleware(new NextRequest(`${SITE}/login?next=%2Fbilling`));
    const location = new URL(res.headers.get("location") as string);
    expect(location.origin).toBe(SITE);
    expect(`${location.pathname}${location.search}`).toBe("/billing?plan=pro");
  });

  it("compares against the request's own origin (127.0.0.1 is not rewritten to another host)", async () => {
    forced.value = "/billing";
    const res = await middleware(new NextRequest("http://127.0.0.1:3111/login?next=%2Fbilling"));
    expect(new URL(res.headers.get("location") as string).pathname).toBe("/billing");
  });
});
