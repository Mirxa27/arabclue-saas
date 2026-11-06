/**
 * Salla connect against a real Supabase stack (GoTrue + PostgREST + Postgres with this repo's
 * migrations, incl. 20261106003000_salla_connect.sql). Runs only when these are set, e.g.
 *   SUPABASE_IT_URL=http://127.0.0.1:54321 SUPABASE_IT_ANON_KEY=… SUPABASE_IT_SERVICE_KEY=… \
 *     npx vitest run __tests__/integration/salla.int.test.ts
 *
 * Proves with real sessions and real SQL:
 *  - GET /api/integrations/status with the session cookie @supabase/ssr itself writes returns the
 *    right salla_connected for a linked and an unlinked merchant (no tokens in the body);
 *  - an Easy Mode install is claimable only by the owner email, through POST /api/salla/installs/claim;
 *  - concurrent getSallaAccessToken calls refresh once (salla_claim_refresh_lease + CAS) and the
 *    rotated refresh token is persisted encrypted;
 *  - the Data API refuses salla_installs and the Salla functions to a signed-in user.
 * Only accounts.salla.sa is stubbed (no Salla credentials here); everything else is real.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextRequest } from "next/server";

const URL_ = process.env.SUPABASE_IT_URL;
const ANON = process.env.SUPABASE_IT_ANON_KEY;
const KEY = process.env.SUPABASE_IT_SERVICE_KEY;
const enabled = Boolean(URL_ && ANON && KEY);

/** The cookies of the "browser" making the next request. */
const jar = vi.hoisted(() => ({ cookies: [] as Array<{ name: string; value: string }> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => jar.cookies,
    set: () => undefined
  })
}));
vi.mock("@/lib/observability/error-reporter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/error-reporter")>()),
  reportError: vi.fn()
}));

import { GET as status } from "@/app/api/integrations/status/route";
import { POST as claim } from "@/app/api/salla/installs/claim/route";
import { encryptSallaTokens, linkSallaStore, recordSallaAuthorization } from "@/lib/salla/connect";
import { getSallaAccessToken } from "@/lib/salla/tokens";
import { decryptSecret } from "@/lib/crypto/secrets";

type Account = { userId: string; email: string; password: string; merchantId: string; cookies: Array<{ name: string; value: string }> };

describe.skipIf(!enabled)("Salla connect on a real Supabase stack", () => {
  let admin: SupabaseClient;
  const run = randomUUID().slice(0, 8);
  const storeA = `it-store-a-${run}`;
  const storeB = `it-store-b-${run}`;
  const accounts: Account[] = [];

  /** Sign in with the password grant and capture the session cookies @supabase/ssr writes. */
  async function sessionCookies(email: string, password: string) {
    const anon = createClient(URL_!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw error ?? new Error("no session");
    const captured = new Map<string, string>();
    const ssr = createServerClient(URL_!, ANON!, {
      cookies: {
        getAll: () => [...captured].map(([name, value]) => ({ name, value })),
        setAll: ((items) => {
          for (const c of items) {
            if (c.value) captured.set(c.name, c.value);
            else captured.delete(c.name);
          }
        }) satisfies SetAllCookies
      }
    });
    const set = await ssr.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
    if (set.error) throw set.error;
    return [...captured].map(([name, value]) => ({ name, value }));
  }

  async function account(label: string): Promise<Account> {
    const email = `it-salla-${label}-${run}@example.test`;
    const password = `pw-${randomUUID()}`;
    const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (user.error) throw user.error;
    const merchantId = randomUUID();
    const ins = await admin.from("merchants").insert({ id: merchantId, owner_user_id: user.data.user!.id, seller_name: `IT ${label}` });
    if (ins.error) throw ins.error;
    const acct = { userId: user.data.user!.id, email, password, merchantId, cookies: await sessionCookies(email, password) };
    accounts.push(acct);
    return acct;
  }

  const asBrowser = (a: Account) => (jar.cookies = a.cookies);

  beforeAll(async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_!);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON!);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", KEY!);
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "integration-token-encryption-key-32-chars");
    vi.stubEnv("SALLA_CLIENT_ID", "it-client");
    vi.stubEnv("SALLA_CLIENT_SECRET", "it-secret");
    vi.stubEnv("SALLA_REDIRECT_URI", "http://localhost:3111/api/salla/oauth/callback");
    vi.stubEnv("NEXT_PUBLIC_SALLA_INSTALL_URL", "");
    admin = createClient(URL_!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    if (!admin) return;
    await admin.from("salla_installs").delete().in("salla_merchant_id", [storeA, storeB]);
    await admin.from("merchants").delete().in("id", accounts.map((a) => a.merchantId));
    for (const a of accounts) await admin.auth.admin.deleteUser(a.userId);
  });

  it("status route: a linked merchant is connected, through the real session cookie", async () => {
    const a = await account("a");
    const outcome = await linkSallaStore(admin, {
      merchantId: a.merchantId,
      storeId: storeA,
      storeName: "متجر التكامل",
      tokens: encryptSallaTokens({ access_token: "it-access", refresh_token: "it-refresh", expires_in: 1209600 })
    });
    expect(outcome).toBe("linked");

    // the stored row holds ciphertext only
    const { data: row } = await admin.from("merchants").select("access_token, refresh_token, salla_merchant_id").eq("id", a.merchantId).single();
    expect(row?.access_token).toMatch(/^enc:v1:/);
    expect(decryptSecret(row?.refresh_token)).toBe("it-refresh");

    asBrowser(a);
    const res = await status();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      salla_connected: true,
      salla_store: { id: storeA, name: "متجر التكامل" },
      salla_install_url: "/api/salla/oauth/start",
      salla_pending_install: null
    });
    expect(JSON.stringify(body)).not.toMatch(/enc:v1:|it-access|it-refresh/);

    // a second merchant cannot take the store
    const other = await account("c");
    expect(
      await linkSallaStore(admin, {
        merchantId: other.merchantId,
        storeId: storeA,
        storeName: null,
        tokens: encryptSallaTokens({ access_token: "x", expires_in: 60 })
      })
    ).toBe("store_already_linked");
  }, 60_000);

  it("Easy Mode: an unlinked merchant sees and claims only the install made with their email", async () => {
    const b = await account("b");
    const stranger = await account("d");
    const parked = await recordSallaAuthorization(admin, {
      storeId: storeB,
      tokens: encryptSallaTokens({ access_token: "easy-access", refresh_token: "easy-refresh", expires_in: 1209600 }),
      scope: "offline_access",
      identity: { storeId: storeB, storeName: "Easy Store", storeDomain: "https://easy.example", userEmail: b.email, userRole: "user" }
    });
    expect(parked).toEqual({ outcome: "pending_saved" });

    asBrowser(b);
    let body = await (await status()).json();
    expect(body).toMatchObject({ salla_connected: false, salla_pending_install: { store_id: storeB, store_name: "Easy Store" } });

    // someone else's session cannot claim it, whatever store id they send
    asBrowser(stranger);
    expect((await (await status()).json()).salla_pending_install).toBeNull();
    const refused = await claim(claimRequest(storeB));
    expect(refused.status).toBe(404);

    asBrowser(b);
    const claimed = await claim(claimRequest(storeB));
    expect(claimed.status).toBe(200);
    body = await (await status()).json();
    expect(body).toMatchObject({ salla_connected: true, salla_store: { id: storeB }, salla_pending_install: null });
    const { count } = await admin.from("salla_installs").select("*", { count: "exact", head: true }).eq("salla_merchant_id", storeB);
    expect(count).toBe(0);
  }, 60_000);

  it("concurrent token refresh against real Postgres: one Salla call, rotated token persisted encrypted", async () => {
    const a = accounts.find((x) => x.email.includes("-a-"))!;
    await admin.from("merchants").update({ token_expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", a.merchantId);

    const realFetch = globalThis.fetch;
    let refreshCalls = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === "https://accounts.salla.sa/oauth2/token") {
        refreshCalls += 1;
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("refresh_token")).toBe("it-refresh");
        await new Promise((r) => setTimeout(r, 150));
        return new Response(JSON.stringify({ access_token: "it-access-2", refresh_token: "it-refresh-2", expires_in: 1209599 }), { status: 200 });
      }
      return realFetch(input, init);
    });

    try {
      const tokens = await Promise.all(Array.from({ length: 6 }, () => getSallaAccessToken(a.merchantId, { client: admin })));
      expect(refreshCalls).toBe(1);
      expect(new Set(tokens)).toEqual(new Set(["it-access-2"]));
    } finally {
      vi.stubGlobal("fetch", realFetch);
    }

    const { data } = await admin
      .from("merchants")
      .select("access_token, refresh_token, token_expires_at, salla_refresh_lease, salla_refresh_lease_until")
      .eq("id", a.merchantId)
      .single();
    expect(decryptSecret(data?.access_token)).toBe("it-access-2");
    expect(decryptSecret(data?.refresh_token)).toBe("it-refresh-2");
    expect(data?.refresh_token).toMatch(/^enc:v1:/);
    expect(Date.parse(String(data?.token_expires_at))).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    expect(data?.salla_refresh_lease).toBeNull();
    expect(data?.salla_refresh_lease_until).toBeNull();
  }, 60_000);

  it("the Data API refuses salla_installs and the Salla functions to a signed-in merchant", async () => {
    const a = accounts[0];
    const anon = createClient(URL_!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
    const signed = await anon.auth.signInWithPassword({ email: a.email, password: a.password });
    expect(signed.error).toBeNull();

    const read = await anon.from("salla_installs").select("*").limit(1);
    expect(read.error?.code).toBe("42501");
    const lease = await anon.rpc("salla_claim_refresh_lease", { p_merchant_id: a.merchantId });
    expect(lease.error?.code).toBe("42501");
    const steal = await anon.rpc("salla_claim_install", { p_merchant_id: a.merchantId, p_salla_merchant_id: storeB, p_owner_email: a.email });
    expect(steal.error?.code).toBe("42501");
    const write = await anon.from("merchants").update({ salla_refresh_lease: null }).eq("id", a.merchantId);
    expect(write.error?.code).toBe("42501");
  }, 60_000);
});

function claimRequest(storeId: string) {
  return new NextRequest("http://localhost:3111/api/salla/installs/claim", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}` },
    body: JSON.stringify({ store_id: storeId })
  });
}
