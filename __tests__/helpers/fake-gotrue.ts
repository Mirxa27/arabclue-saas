/**
 * Minimal GoTrue stand-in at the fetch level, so tests run the REAL @supabase/ssr server
 * client (PKCE verifier cookie, session cookies, chunking) against scripted auth responses.
 */
import { vi } from "vitest";

export const SUPABASE_URL = "https://abcdefgh.supabase.co";
export const ANON_KEY = "anon-test-key";
/** Cookie prefix the SSR client derives from SUPABASE_URL. */
export const AUTH_COOKIE = "sb-abcdefgh-auth-token";

export type GoTrueCall = { method: string; url: URL; body: Record<string, unknown> | null; headers: Headers };
type Handler = (call: GoTrueCall) => Response | Promise<Response>;

function b64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

export function fakeJwt(payload: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}.${b64url("signature")}`;
}

export function fakeUser(id = "11111111-1111-4111-8111-111111111111", email = "merchant@example.com") {
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email,
    app_metadata: { provider: "email" },
    user_metadata: {},
    created_at: new Date().toISOString()
  };
}

export function fakeSession(userId?: string) {
  const user = fakeUser(userId);
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: fakeJwt({ sub: user.id, exp: now + 3600, role: "authenticated", aud: "authenticated" }),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: "refresh-token-123",
    user
  };
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function authError(status: number, errorCode: string, msg = "error"): Response {
  return json(status, { code: status, error_code: errorCode, msg });
}

/**
 * Stub global fetch. `routes` maps "METHOD /auth/v1/path" to a handler; unmatched requests
 * fail the test loudly. Returns the recorded calls.
 */
export function stubGoTrue(routes: Record<string, Handler>): GoTrueCall[] {
  const calls: GoTrueCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      const call: GoTrueCall = { method, url, body, headers: new Headers(init?.headers) };
      calls.push(call);
      const handler = routes[`${method} ${url.pathname}`];
      if (!handler) throw new Error(`Unexpected fetch ${method} ${url.href}`);
      return handler(call);
    })
  );
  return calls;
}

/** `name=value` pairs from a response's Set-Cookie headers. */
export function setCookies(res: Response): Map<string, { value: string; raw: string }> {
  const out = new Map<string, { value: string; raw: string }>();
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    out.set(pair.slice(0, eq).trim(), { value: pair.slice(eq + 1), raw });
  }
  return out;
}

/** Cookie header carrying every non-empty cookie a response set. */
export function cookieHeaderFrom(res: Response): string {
  return [...setCookies(res).entries()]
    .filter(([, c]) => c.value !== "")
    .map(([name, c]) => `${name}=${c.value}`)
    .join("; ");
}
