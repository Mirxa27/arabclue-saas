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

import { reportError } from "@/lib/observability/error-reporter";
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

  // RA-4: one client used to get a fresh budget for every new address (key = IP + email).
  it("caps sign-in emails per client IP across addresses, keyed on the proxy-appended IP (spoofed XFF entries don't help)", async () => {
    const calls = stubGoTrue({ "POST /auth/v1/otp": () => json(200, {}) });
    for (let i = 0; i < 20; i++) {
      const ok = await otpPost(otpRequest({ email: uniqueEmail() }, { "x-forwarded-for": `10.9.9.${i}, 203.0.113.77` }));
      expect(ok.status).toBe(200);
    }
    const limited = await otpPost(otpRequest({ email: uniqueEmail() }, { "x-forwarded-for": "10.9.9.99, 203.0.113.77" }));
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { code: string }).code).toBe("rate_limited");
    expect(calls).toHaveLength(20);
    // Another client is a separate budget.
    expect((await otpPost(otpRequest({ email: uniqueEmail() }, { "x-forwarded-for": "203.0.113.78" }))).status).toBe(200);
  });

  // RA-4: one address could be sent unlimited sign-in emails by rotating clients.
  it("caps sign-in emails per normalised address, whichever client asks", async () => {
    const calls = stubGoTrue({ "POST /auth/v1/otp": () => json(200, {}) });
    const local = `victim${Date.now()}${Math.random().toString(16).slice(2)}`;
    const variants = [`${local}@example.com`, ` ${local.toUpperCase()}@Example.com `, `${local}+promo@example.com`];
    for (const email of variants) {
      expect((await otpPost(otpRequest({ email, mode: "login" }))).status).toBe(200);
    }
    // 4th request for the same inbox, from yet another IP and in the other mode: refused before Supabase.
    const limited = await otpPost(otpRequest({ email: `${local}+other@example.com`, mode: "signup", name: "X" }));
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { code: string }).code).toBe("rate_limited");
    expect(calls).toHaveLength(3);
    // A different address is unaffected.
    expect((await otpPost(otpRequest({ email: uniqueEmail() }))).status).toBe(200);
  });

  it("treats Gmail dot and googlemail variants as the same inbox for the per-address cap", async () => {
    stubGoTrue({ "POST /auth/v1/otp": () => json(200, {}) });
    const local = `gm${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
    const dotted = `${local.slice(0, 3)}.${local.slice(3)}`;
    for (const email of [`${local}@gmail.com`, `${dotted}@gmail.com`, `${local}@googlemail.com`]) {
      expect((await otpPost(otpRequest({ email }))).status).toBe(200);
    }
    expect((await otpPost(otpRequest({ email: `${dotted}+x@googlemail.com` }))).status).toBe(429);
  });

  describe("Supabase IP forwarding (SUPABASE_SECRET_KEY)", () => {
    it("sends the secret key and the trusted client IP as sb-forwarded-for when configured", async () => {
      vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_forwarding_key");
      const calls = stubGoTrue({ "POST /auth/v1/otp": () => json(200, {}) });
      const res = await otpPost(otpRequest({ email: uniqueEmail() }, { "x-forwarded-for": "6.6.6.6, 203.0.113.91" }));
      expect(res.status).toBe(200);
      expect(calls).toHaveLength(1);
      expect(calls[0].headers.get("apikey")).toBe("sb_secret_test_forwarding_key");
      // The proxy-appended address, never the spoofable left-most entry.
      expect(calls[0].headers.get("sb-forwarded-for")).toBe("203.0.113.91");
    });

    it("forwards the client IP on token-hash verification too", async () => {
      vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_forwarding_key");
      const calls = stubGoTrue({ "POST /auth/v1/verify": () => json(200, fakeSession()) });
      const res = await confirmGet(
        new NextRequest(`${SITE}/auth/confirm?token_hash=th-fwd&type=email`, { headers: { "x-forwarded-for": "203.0.113.92" } })
      );
      expect(res.headers.get("location")).toBe("/dashboard");
      expect(calls[0].headers.get("sb-forwarded-for")).toBe("203.0.113.92");
      expect(calls[0].headers.get("apikey")).toBe("sb_secret_test_forwarding_key");
    });

    it("behaves as before without a usable secret key (unset, legacy JWT) or without a known client IP", async () => {
      vi.stubEnv("SUPABASE_SECRET_KEY", "");
      const calls = stubGoTrue({ "POST /auth/v1/otp": () => json(200, {}) });
      await otpPost(otpRequest({ email: uniqueEmail() }));
      vi.stubEnv("SUPABASE_SECRET_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln");
      await otpPost(otpRequest({ email: uniqueEmail() }));
      for (const call of calls) {
        expect(call.headers.get("apikey")).toBe(ANON_KEY);
        expect(call.headers.get("sb-forwarded-for")).toBeNull();
      }

      vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_forwarding_key");
      vi.stubEnv("TRUSTED_PROXY_HOPS", "0"); // client IP unknown → nothing to forward
      const unknownIp = stubGoTrue({ "POST /auth/v1/otp": () => json(200, {}) });
      expect((await otpPost(otpRequest({ email: uniqueEmail() }))).status).toBe(200);
      expect(unknownIp[0].headers.get("sb-forwarded-for")).toBeNull();
    });
  });
});

describe("POST /api/auth/otp same-origin check (RA-6)", () => {
  const PUBLIC = "https://arabclue.example";
  // `next start` / a custom server: req.url carries the server's own host:port, never the public one.
  const INTERNAL = "http://localhost:3000";

  function proxiedOtp(origin: string, extra: Record<string, string> = {}): NextRequest {
    ipCounter += 1;
    return new NextRequest(`${INTERNAL}/api/auth/otp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "arabclue.example",
        "x-forwarded-host": "arabclue.example",
        "x-forwarded-proto": "https",
        "x-forwarded-for": `198.51.100.${ipCounter}`,
        "sec-fetch-site": "same-origin",
        origin,
        ...extra
      },
      body: JSON.stringify({ email: uniqueEmail(), mode: "login" })
    });
  }

  it("accepts the public origin behind a proxy even when NEXT_PUBLIC_SITE_URL is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const calls = stubGoTrue({ "POST /auth/v1/otp": () => json(200, {}) });
    const res = await otpPost(proxiedOtp(PUBLIC));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("accepts a Host-only proxy (no X-Forwarded-Host) and still rejects foreign origins with a distinct, reported code", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const calls = stubGoTrue({ "POST /auth/v1/otp": () => json(200, {}) });
    const hostOnly = proxiedOtp(PUBLIC);
    hostOnly.headers.delete("x-forwarded-host");
    expect((await otpPost(hostOnly)).status).toBe(200);

    vi.mocked(reportError).mockClear();
    const foreign = await otpPost(proxiedOtp("https://evil.example", { "sec-fetch-site": "cross-site" }));
    expect(foreign.status).toBe(403);
    expect(((await foreign.json()) as { code: string }).code).toBe("cross_site");
    expect(foreign.headers.getSetCookie()).toEqual([]);
    expect(reportError).toHaveBeenCalledTimes(1);
    const [, context] = vi.mocked(reportError).mock.calls[0];
    expect(context).toMatchObject({ route: "POST /api/auth/otp", status: 403 });
    expect(JSON.stringify(context?.extra)).toContain("https://evil.example");
    expect(calls).toHaveLength(1);
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

  // RA-1 / RA-5: a dot-segment next normalised to "//host" made relativeRedirect throw AFTER the
  // one-time token had been consumed, so the user ended on /login?error=unknown, signed out.
  it.each([
    ["/auth/callback", () => callbackGet],
    ["/auth/confirm", () => confirmGet]
  ])("%s signs the user in and lands on /dashboard for dot-segment next values", async (path, handler) => {
    for (const next of ["/.//evil.example/x", "/%2e//evil.example", "/a/..//evil.example", "/x/.././/evil", "/./%2F/evil.example"]) {
      const calls = stubGoTrue({ "POST /auth/v1/verify": () => json(200, fakeSession()) });
      const res = await handler()(
        new NextRequest(`${SITE}${path}?token_hash=th-${calls.length}&type=magiclink&next=${encodeURIComponent(next)}`)
      );
      expect(res.status, next).toBe(303);
      expect(res.headers.get("location"), next).toBe("/dashboard");
      expect(calls, next).toHaveLength(1);
      const cookies = setCookies(res);
      expect((cookies.get(AUTH_COOKIE) ?? cookies.get(`${AUTH_COOKIE}.0`))?.value, next).toMatch(/^base64-/);
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

  // RA-4: junk token hashes used to reach GoTrue without any app-side cap, draining the shared
  // per-IP verify budget of this server for every merchant.
  it("caps verification attempts per client before calling Supabase", async () => {
    const calls = stubGoTrue({ "POST /auth/v1/verify": () => authError(403, "otp_expired", "expired") });
    const confirm = () =>
      confirmGet(new NextRequest(`${SITE}/auth/confirm?token_hash=junk&type=email`, { headers: { "x-forwarded-for": "203.0.113.150" } }));
    for (let i = 0; i < 30; i++) expect((await confirm()).headers.get("location")).toBe("/login?error=link_expired");
    const limited = await confirm();
    expect(limited.status).toBe(303);
    expect(limited.headers.get("location")).toBe("/login?error=rate_limited");
    expect(calls).toHaveLength(30);
    // Another client still gets through.
    const other = await confirmGet(
      new NextRequest(`${SITE}/auth/confirm?token_hash=junk&type=email`, { headers: { "x-forwarded-for": "203.0.113.151" } })
    );
    expect(other.headers.get("location")).toBe("/login?error=link_expired");
  });

  describe("Magic Link template redirect_to={{ .RedirectTo }} (RA-7)", () => {
    // The documented template: …&type=email&next=/dashboard&redirect_to={{ .RedirectTo }} (last param).
    // Go's text/template inserts RedirectTo verbatim, so its own query arrives unescaped.
    const confirmWith = (redirectTo: string, extra = "") => {
      stubGoTrue({ "POST /auth/v1/verify": () => json(200, fakeSession()) });
      return confirmGet(
        new NextRequest(`${SITE}/auth/confirm?token_hash=rt-hash&type=email&next=/dashboard${extra}&redirect_to=${redirectTo}`)
      );
    };

    it("resumes the next the sign-in was requested with (deep links); OAuth starts land on their page", async () => {
      // An email link must never continue straight into a route handler: /api/oauth/*/start
      // would begin connecting the visitor's accounts under whatever account the link signed
      // them into. It lands on /integrations, one deliberate click away.
      const oauth = await confirmWith(`${SITE}/auth/callback?next=${encodeURIComponent("/api/oauth/linkedin/start")}`);
      expect(oauth.headers.get("location")).toBe("/integrations");
      const billing = await confirmWith(`${SITE}/auth/callback?next=%2Fbilling`);
      expect(billing.headers.get("location")).toBe("/billing");
    });

    it("keeps a nested query intact (Moyasar return URL)", async () => {
      const target = "/billing/complete?intent=abc123&plan=pro";
      const res = await confirmWith(`${SITE}/auth/callback?next=${encodeURIComponent(target)}`);
      expect(res.headers.get("location")).toBe(target);
    });

    it("also understands an escaped RedirectTo", async () => {
      const res = await confirmWith(encodeURIComponent(`${SITE}/auth/callback?next=${encodeURIComponent("/billing?tab=plans")}`));
      expect(res.headers.get("location")).toBe("/billing?tab=plans");
    });

    it.each([
      ["a foreign origin", "https://evil.example/auth/callback?next=%2Fbilling"],
      ["the bare Site URL (no valid redirect_to was requested)", SITE],
      ["the Site URL with a slash", `${SITE}/`],
      ["another path on our origin", `${SITE}/billing?next=%2Fbilling`],
      ["an unsafe next inside it", `${SITE}/auth/callback?next=${encodeURIComponent("/.//evil.example")}`],
      ["the signup default (a returning user who started on /signup)", `${SITE}/auth/callback?next=%2Fwelcome`],
      ["garbage", "not a url"]
    ])("falls back to the template's next for %s", async (_label, redirectTo) => {
      const res = await confirmWith(redirectTo);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/dashboard");
    });

    it("keeps the resumed next on failure, so a new link returns there", async () => {
      stubGoTrue({ "POST /auth/v1/verify": () => authError(403, "otp_expired", "expired") });
      const res = await confirmGet(
        new NextRequest(`${SITE}/auth/confirm?token_hash=old&type=email&next=/dashboard&redirect_to=${SITE}/auth/callback?next=%2Fbilling`)
      );
      expect(res.headers.get("location")).toBe("/login?error=link_expired&next=%2Fbilling");
    });
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
