/**
 * Sign-in and OAuth fixes against a real Supabase stack (GoTrue + PostgREST + Postgres with this
 * repo's migrations). Runs only when these are set, e.g.
 *   SUPABASE_IT_URL=http://127.0.0.1:54321 SUPABASE_IT_ANON_KEY=… SUPABASE_IT_SERVICE_KEY=… \
 *     npx vitest run __tests__/integration/auth-fixes.int.test.ts
 *
 * Proves with real one-time tokens, real sessions and real SQL:
 *  - RA-1/RA-5: /auth/confirm with a dot-segment `next` that normalises to "//host" consumes the
 *    token AND signs the user in on /dashboard (it used to throw after the token was spent), and
 *    the real middleware keeps that signed-in user on the site for /login?next=/.//evil…;
 *  - RA-7: a Magic Link carrying redirect_to={{ .RedirectTo }} lands on the requested `next`;
 *  - RA-8/RA-13: connecting a provider account that another store already holds hits the real
 *    social_channels_platform_external_id_key index and reports channel_already_connected.
 * Links come from the admin generateLink API, so no email is sent (the shared stack's email
 * budget is untouched) and only a few verify calls are made.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { cookieHeaderFrom } from "../helpers/fake-gotrue";

const URL_ = process.env.SUPABASE_IT_URL;
const ANON = process.env.SUPABASE_IT_ANON_KEY;
const KEY = process.env.SUPABASE_IT_SERVICE_KEY;
const enabled = Boolean(URL_ && ANON && KEY);

vi.mock("@/lib/observability/error-reporter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/error-reporter")>()),
  reportError: vi.fn()
}));

import { GET as confirmGet } from "@/app/auth/confirm/route";
import { middleware } from "@/middleware";
import { persistSocialConnection } from "@/lib/oauth/flow";
import { OAuthCallbackError } from "@/lib/oauth/errors";

const SITE = "http://localhost:3111";

describe.skipIf(!enabled)("auth fixes on a real Supabase stack", () => {
  let admin: SupabaseClient;
  const run = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const merchantIds: string[] = [];

  async function magicLinkHash(label: string): Promise<string> {
    const email = `it-auth-${label}-${run}@example.test`;
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (created.error) throw created.error;
    userIds.push(created.data.user!.id);
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error) throw link.error;
    return link.data.properties.hashed_token;
  }

  const confirm = (query: string, ip: string) =>
    confirmGet(new NextRequest(`${SITE}/auth/confirm?${query}`, { headers: { "x-forwarded-for": ip } }));

  beforeAll(async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_!);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON!);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", KEY!);
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "integration-token-encryption-key-32-chars");
    admin = createClient(URL_!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (!admin) return;
    if (merchantIds.length) {
      await admin.from("social_channels").delete().in("merchant_id", merchantIds);
      await admin.from("merchants").delete().in("id", merchantIds);
    }
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  it("RA-1/RA-5: a dot-segment next still signs the user in on /dashboard, and the middleware stays on-site", async () => {
    const hash = await magicLinkHash("dot");
    const res = await confirm(`token_hash=${hash}&type=magiclink&next=${encodeURIComponent("/.//evil.example/phish")}`, "203.0.113.201");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/dashboard");
    const cookie = cookieHeaderFrom(res);
    expect(cookie).toMatch(/sb-[a-z0-9]+-auth-token(\.0)?=base64-/);

    // The token is spent: the same link now fails, so the session above came from it.
    const reused = await confirm(`token_hash=${hash}&type=magiclink`, "203.0.113.201");
    expect(reused.headers.get("location")).toBe("/login?error=link_expired");

    // Real middleware, real GoTrue getUser with that session: never an off-site Location.
    for (const page of ["/login", "/signup"]) {
      for (const evil of ["/.//evil.example/phish", "/%2e//evil.example", "/a/..//evil.example"]) {
        const mw = await middleware(new NextRequest(`${SITE}${page}?next=${encodeURIComponent(evil)}`, { headers: { cookie } }));
        expect(mw.status).toBe(307);
        const location = new URL(mw.headers.get("location") as string);
        expect(location.origin).toBe(SITE);
        expect(location.pathname).toBe("/dashboard");
      }
    }
  }, 30_000);

  it("RA-7: redirect_to={{ .RedirectTo }} resumes the requested next after a real verification", async () => {
    const hash = await magicLinkHash("rt");
    const redirectTo = `${SITE}/auth/callback?next=${encodeURIComponent("/billing/complete?intent=it-1&plan=pro")}`;
    const res = await confirm(`token_hash=${hash}&type=email&next=/dashboard&redirect_to=${redirectTo}`, "203.0.113.202");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/billing/complete?intent=it-1&plan=pro");
    expect(cookieHeaderFrom(res)).toMatch(/-auth-token(\.0)?=base64-/);
  }, 30_000);

  it("RA-8/RA-13: an account another store already holds is reported as channel_already_connected", async () => {
    const owners: string[] = [];
    for (const label of ["a", "b"]) {
      const created = await admin.auth.admin.createUser({ email: `it-auth-chan-${label}-${run}@example.test`, email_confirm: true });
      if (created.error) throw created.error;
      userIds.push(created.data.user!.id);
      owners.push(created.data.user!.id);
    }
    const [merchantA, merchantB] = [randomUUID(), randomUUID()];
    for (const [i, id] of [merchantA, merchantB].entries()) {
      const ins = await admin.from("merchants").insert({ id, owner_user_id: owners[i], seller_name: `IT chan ${i}` });
      if (ins.error) throw ins.error;
      merchantIds.push(id);
    }
    const externalId = `urn:li:organization:it-${run}`;
    const held = await admin.from("social_channels").insert({ merchant_id: merchantA, platform: "linkedin", external_id: externalId });
    if (held.error) throw held.error;

    const attempt = persistSocialConnection({
      merchantId: merchantB,
      platform: "linkedin",
      tokens: { accessToken: "it-access", expiresIn: 3600 },
      resolveExternalId: async () => externalId
    });
    await expect(attempt).rejects.toBeInstanceOf(OAuthCallbackError);
    await expect(attempt).rejects.toMatchObject({ code: "channel_already_connected" });

    // Merchant B got nothing; merchant A still holds the account.
    const { data: rows } = await admin.from("social_channels").select("merchant_id").eq("external_id", externalId);
    expect(rows).toEqual([{ merchant_id: merchantA }]);
  }, 30_000);
});
