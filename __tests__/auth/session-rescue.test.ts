/**
 * POST /auth/session — finishes magic links sent with the old implicit flow
 * (#access_token=…&refresh_token=…) by validating the tokens with Supabase and setting
 * the cookie session. Must be same-origin JSON (no login CSRF).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  ANON_KEY,
  AUTH_COOKIE,
  SUPABASE_URL,
  authError,
  fakeSession,
  fakeUser,
  json,
  setCookies,
  stubGoTrue
} from "../helpers/fake-gotrue";

vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import { POST } from "@/app/auth/session/route";

const SITE = "http://localhost:3111";
let ip = 0;

function rescueRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  ip += 1;
  return new NextRequest(`${SITE}/auth/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: SITE,
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": `192.0.2.${ip}`,
      ...headers
    },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /auth/session", () => {
  it("validates the access token with Supabase, then sets the session cookies", async () => {
    const session = fakeSession();
    const calls = stubGoTrue({ "GET /auth/v1/user": () => json(200, fakeUser()) });

    const res = await POST(
      rescueRequest({ access_token: session.access_token, refresh_token: session.refresh_token, next: "/integrations" })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: "/integrations" });
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${session.access_token}`);
    const cookies = setCookies(res);
    expect((cookies.get(AUTH_COOKIE) ?? cookies.get(`${AUTH_COOKIE}.0`))?.value).toMatch(/^base64-/);
  });

  it("refuses tokens Supabase does not accept, without setting cookies", async () => {
    const session = fakeSession();
    stubGoTrue({ "GET /auth/v1/user": () => authError(403, "bad_jwt", "invalid JWT") });
    const res = await POST(rescueRequest({ access_token: session.access_token, refresh_token: "rt" }));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("session_failed");
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("rejects malformed tokens", async () => {
    stubGoTrue({});
    const res = await POST(rescueRequest({ access_token: "not-a-jwt", refresh_token: "rt" }));
    expect(res.status).toBe(401);
  });

  it("rejects cross-site and non-JSON requests (login CSRF)", async () => {
    const calls = stubGoTrue({});
    const body = { access_token: fakeSession().access_token, refresh_token: "rt" };
    expect((await POST(rescueRequest(body, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(rescueRequest(body, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    const noOrigin = rescueRequest(body);
    noOrigin.headers.delete("origin");
    expect((await POST(noOrigin)).status).toBe(403);
    expect((await POST(rescueRequest(body, { "content-type": "text/plain" }))).status).toBe(415);
    expect(calls).toHaveLength(0);
  });

  it("only hands back a safe next", async () => {
    stubGoTrue({ "GET /auth/v1/user": () => json(200, fakeUser()) });
    const session = fakeSession();
    const res = await POST(
      rescueRequest({ access_token: session.access_token, refresh_token: session.refresh_token, next: "//evil.example" })
    );
    expect(((await res.json()) as { next: string }).next).toBe("/dashboard");
  });
});
