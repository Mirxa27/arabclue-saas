/**
 * Magic-link sign-in (F02 / critic-8): POST /api/auth/otp runs the PKCE flow through the
 * @supabase/ssr server client, and /auth/callback + /auth/confirm turn the emailed link into
 * cookie-session + redirect. GoTrue is faked at the fetch level (see helpers/fake-gotrue).
 */
import { createHash } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  ANON_KEY,
  AUTH_COOKIE,
  SUPABASE_URL,
  authError,
  cookieHeaderFrom,
  fakeSession,
  json,
  setCookies,
  stubGoTrue
} from "../helpers/fake-gotrue";

vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import { POST as otpPost } from "@/app/api/auth/otp/route";
import { GET as callbackGet } from "@/app/auth/callback/route";
import { GET as confirmGet } from "@/app/auth/confirm/route";

const SITE = "http://localhost:3111";
let ipCounter = 0;

function otpRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  ipCounter += 1;
  return new NextRequest(`${SITE}/api/auth/otp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: SITE,
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": `198.51.100.${ipCounter}`,
      ...headers
    },
    body: JSON.stringify(body)
  });
}

const uniqueEmail = () => `m${Date.now()}${Math.random().toString(16).slice(2)}@example.com`;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/auth/otp", () => {
  it("requests a PKCE magic link and sets the code-verifier cookie on the response", async () => {
    const calls = stubGoTrue({ "POST /auth/v1/otp": () => json(200, {}) });
    const email = uniqueEmail();

    const res = await otpPost(otpRequest({ email, mode: "login", next: "/integrations?tab=social" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    // emailRedirectTo is built server-side from the site URL + a validated relative next.
    expect(call.url.searchParams.get("redirect_to")).toBe(
      `${SITE}/auth/callback?next=${encodeURIComponent("/integrations?tab=social")}`
    );
    expect(call.body).toMatchObject({ email, create_user: true, code_challenge_method: "s256" });
    expect(typeof call.body?.code_challenge).toBe("string");

    const verifier = setCookies(res).get(`${AUTH_COOKIE}-code-verifier`);
    expect(verifier?.value).toMatch(/^base64-/);
    expect(verifier?.raw).toMatch(/Path=\//);
    expect(verifier?.raw).toMatch(/SameSite=Lax/i);
  });

  it("ignores absolute or protocol-relative next values (and the legacy redirectTo field)", async () => {
    const calls = stubGoTrue({ "POST /auth/v1/otp": () => json(200, {}) });
    await otpPost(otpRequest({ email: uniqueEmail(), next: "https://evil.example/phish", redirectTo: "https://evil.example" }));
    await otpPost(otpRequest({ email: uniqueEmail(), mode: "signup", name: "Layla", next: "//evil.example" }));

    expect(calls[0].url.searchParams.get("redirect_to")).toBe(`${SITE}/auth/callback?next=%2Fdashboard`);
    expect(calls[1].url.searchParams.get("redirect_to")).toBe(`${SITE}/auth/callback?next=%2Fwelcome`);
    expect(calls[1].body?.data).toEqual({ full_name: "Layla" });
  });

  it("returns stable codes instead of Supabase's text", async () => {
    stubGoTrue({
      "POST /auth/v1/otp": () => authError(429, "over_email_send_rate_limit", "For security purposes, you can only request this after 52 seconds.")
    });
    const res = await otpPost(otpRequest({ email: uniqueEmail() }));
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("rate_limited");
    expect(body.error).not.toContain("52 seconds");
  });

  it("rejects an invalid email with invalid_email and never calls Supabase", async () => {
    const calls = stubGoTrue({});
    const res = await otpPost(otpRequest({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_email");
    expect(calls).toHaveLength(0);
  });

  it("rejects cross-site posts and non-JSON bodies (no verifier planted by a third-party form)", async () => {
    const calls = stubGoTrue({ "POST /auth/v1/otp": () => json(200, {}) });
    const crossSite = await otpPost(otpRequest({ email: uniqueEmail() }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }));
    expect(crossSite.status).toBe(403);
    expect(crossSite.headers.getSetCookie()).toEqual([]);
    // <form enctype="text/plain"> can smuggle a JSON-looking body; it is refused by content type.
    const textPlain = await otpPost(otpRequest({ email: uniqueEmail() }, { "content-type": "text/plain" }));
    expect(textPlain.status).toBe(415);
    expect(calls).toHaveLength(0);
  });

  it("rate-limits per client + address, keyed on the proxy-appended IP (spoofed XFF entries don't help)", async () => {
    stubGoTrue({ "POST /auth/v1/otp": () => json(200, {}) });
    const email = uniqueEmail();
    for (let i = 0; i < 5; i++) {
      const ok = await otpPost(otpRequest({ email }, { "x-forwarded-for": `10.9.9.${i}, 203.0.113.77` }));
      expect(ok.status).toBe(200);
    }
    const limited = await otpPost(otpRequest({ email }, { "x-forwarded-for": "10.9.9.99, 203.0.113.77" }));
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { code: string }).code).toBe("rate_limited");
    // Another address from the same client is a separate budget.
    expect((await otpPost(otpRequest({ email: uniqueEmail() }, { "x-forwarded-for": "203.0.113.77" }))).status).toBe(200);
  });
});

describe("GET /auth/callback (PKCE code)", () => {
  it("exchanges the code with the verifier from the OTP response and sets the session cookies", async () => {
    const session = fakeSession();
    const calls = stubGoTrue({
      "POST /auth/v1/otp": () => json(200, {}),
      "POST /auth/v1/token": () => json(200, session)
    });

    const otpRes = await otpPost(otpRequest({ email: uniqueEmail(), next: "/integrations" }));
    const jar = cookieHeaderFrom(otpRes);

    const res = await callbackGet(
      new NextRequest(`${SITE}/auth/callback?next=%2Fintegrations&code=auth-code-123`, { headers: { cookie: jar } })
    );

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/integrations");

    const tokenCall = calls.find((c) => c.url.pathname === "/auth/v1/token");
    expect(tokenCall?.url.searchParams.get("grant_type")).toBe("pkce");
    expect(tokenCall?.body?.auth_code).toBe("auth-code-123");
    // The verifier sent to /token is the one whose S256 challenge went to /otp.
    const otpCall = calls.find((c) => c.url.pathname === "/auth/v1/otp");
    const challenge = createHash("sha256").update(String(tokenCall?.body?.code_verifier)).digest("base64url");
    expect(challenge).toBe(otpCall?.body?.code_challenge);

    const cookies = setCookies(res);
    const sessionCookie = cookies.get(AUTH_COOKIE) ?? cookies.get(`${AUTH_COOKIE}.0`);
    expect(sessionCookie?.value).toMatch(/^base64-/);
    expect(cookies.get(`${AUTH_COOKIE}-code-verifier`)?.value).toBe(""); // verifier consumed
  });

  it("sends a link opened in another browser (no verifier cookie) to /login?error=link_other_browser", async () => {
    const calls = stubGoTrue({});
    const res = await callbackGet(new NextRequest(`${SITE}/auth/callback?next=%2Fdashboard&code=abc`));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login?error=link_other_browser");
    expect(calls).toHaveLength(0);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("maps Supabase's error params to a stable code and keeps a safe next", async () => {
    stubGoTrue({});
    const res = await callbackGet(
      new NextRequest(
        `${SITE}/auth/callback?next=%2Fintegrations&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`
      )
    );
    expect(res.headers.get("location")).toBe("/login?error=link_expired&next=%2Fintegrations");
  });

  it("maps a used/expired code to link_expired", async () => {
    stubGoTrue({
      "POST /auth/v1/otp": () => json(200, {}),
      "POST /auth/v1/token": () => authError(404, "flow_state_not_found", "invalid flow state, no valid flow state found")
    });
    const otpRes = await otpPost(otpRequest({ email: uniqueEmail() }));
    const res = await callbackGet(
      new NextRequest(`${SITE}/auth/callback?code=used-code`, { headers: { cookie: cookieHeaderFrom(otpRes) } })
    );
    expect(res.headers.get("location")).toBe("/login?error=link_expired");
  });

  it("never redirects off-site, whatever next says", async () => {
    stubGoTrue({ "POST /auth/v1/verify": () => json(200, fakeSession()) });
    for (const next of ["//evil.example", "https://evil.example", "/\\evil.example", "%2F%2Fevil.example"]) {
      const res = await callbackGet(
        new NextRequest(`${SITE}/auth/callback?token_hash=th&type=email&next=${encodeURIComponent(next)}`)
      );
      expect(res.headers.get("location")).toBe("/dashboard");
    }
  });

  it("treats a request without code or token_hash as an invalid link", async () => {
    stubGoTrue({});
    const res = await callbackGet(new NextRequest(`${SITE}/auth/callback`));
    expect(res.headers.get("location")).toBe("/login?error=link_invalid");
  });
});

describe("GET /auth/confirm (token hash)", () => {
  it("verifies the token hash without any prior cookie and sets the session", async () => {
    const calls = stubGoTrue({ "POST /auth/v1/verify": () => json(200, fakeSession()) });

    const res = await confirmGet(new NextRequest(`${SITE}/auth/confirm?token_hash=hash-abc&type=magiclink&next=%2Fwelcome`));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/welcome");
    expect(calls[0].body).toMatchObject({ token_hash: "hash-abc", type: "magiclink" });
    const cookies = setCookies(res);
    expect((cookies.get(AUTH_COOKIE) ?? cookies.get(`${AUTH_COOKIE}.0`))?.value).toMatch(/^base64-/);
  });

  it("defaults next to /dashboard and maps an expired hash to link_expired", async () => {
    stubGoTrue({ "POST /auth/v1/verify": () => authError(403, "otp_expired", "Email link is invalid or has expired") });
    const res = await confirmGet(new NextRequest(`${SITE}/auth/confirm?token_hash=old&type=email`));
    expect(res.headers.get("location")).toBe("/login?error=link_expired");
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("rejects unknown OTP types without calling Supabase", async () => {
    const calls = stubGoTrue({});
    const res = await confirmGet(new NextRequest(`${SITE}/auth/confirm?token_hash=x&type=sms`));
    expect(res.headers.get("location")).toBe("/login?error=link_invalid");
    expect(calls).toHaveLength(0);
  });

  it("degrades to auth_unavailable (not a 500) when Supabase is unreachable or unconfigured", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const res = await confirmGet(new NextRequest(`${SITE}/auth/confirm?token_hash=x&type=email`));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login?error=auth_unavailable");

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const unconfigured = await confirmGet(new NextRequest(`${SITE}/auth/confirm?token_hash=x&type=email`));
    expect(unconfigured.headers.get("location")).toBe("/login?error=auth_unavailable");
  });
});
