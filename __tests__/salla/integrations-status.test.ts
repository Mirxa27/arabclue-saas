/**
 * UI-001 — GET /api/integrations/status: the contract the integrations page reads
 * ({ salla_connected, salla_install_url, channel_status, oauth_configured, social_oauth_enabled, … }),
 * never any token, and a claimable App Store install only for the confirmed owner email.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";
import { encryptSecret } from "@/lib/crypto/secrets";

const session = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string | null; email_confirmed_at?: string | null },
  merchant: null as null | Record<string, unknown>
}));
const features = vi.hoisted(() => ({ socialOAuth: true }));
let userDb = createFakeSupabase("user");
let serviceDb = createFakeSupabase("service");

vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getSessionContext: vi.fn(async () => ({ user: session.user, merchant: session.merchant }))
}));
vi.mock("@/lib/db/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/supabase")>()),
  getServerSupabase: async () => userDb.client,
  getServiceSupabase: () => serviceDb.client
}));
vi.mock("@/lib/admin/platform-settings", () => ({
  getFeatureSettings: vi.fn(async () => ({ billing: true, zatca: true, wathq: true, socialOAuth: features.socialOAuth }))
}));

import { GET } from "@/app/api/integrations/status/route";

const M = "aaaaaaaa-0000-4000-8000-00000000000a";

function merchant(extra: Record<string, unknown> = {}) {
  return {
    id: M,
    owner_user_id: "user-a",
    salla_merchant_id: "777",
    salla_store_name: "Bait Al Oud",
    access_token: encryptSecret("salla-access"),
    refresh_token: encryptSecret("salla-refresh"),
    token_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    salla_token_invalid_at: null,
    uninstalled_at: null,
    ...extra
  };
}

function channelsDb(platforms: string[]) {
  return createFakeSupabase("user", (call: FakeCall) =>
    call.table === "social_channels" ? { data: platforms.map((platform) => ({ platform })) } : undefined
  );
}

const pendingRow = {
  salla_merchant_id: "9001",
  store_name: "متجر العود",
  store_domain: "https://oud.example",
  authorized_at: new Date().toISOString()
};

beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-token-encryption-key-32-chars-min");
  for (const [k, v] of Object.entries({
    SALLA_CLIENT_ID: "salla-id",
    SALLA_CLIENT_SECRET: "salla-secret",
    SALLA_REDIRECT_URI: "https://arabclue.example/api/salla/oauth/callback",
    NEXT_PUBLIC_SALLA_INSTALL_URL: "",
    META_APP_ID: "meta-id",
    META_APP_SECRET: "meta-secret",
    LINKEDIN_CLIENT_ID: "li-id",
    LINKEDIN_CLIENT_SECRET: "",
    X_CLIENT_ID: "",
    X_CLIENT_SECRET: "",
    TIKTOK_CLIENT_KEY: "tt-key",
    TIKTOK_CLIENT_SECRET: "tt-secret"
  })) vi.stubEnv(k, v);
  features.socialOAuth = true;
  session.user = { id: "user-a", email: "Owner@Example.com", email_confirmed_at: "2026-11-01T00:00:00Z" };
  session.merchant = merchant();
  userDb = channelsDb(["instagram", "whatsapp", "not-a-platform"]);
  serviceDb = createFakeSupabase("service", (call) => (call.table === "salla_installs" ? { data: [pendingRow] } : undefined));
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/integrations/status", () => {
  it("401 signed out, 403 without a merchant profile", async () => {
    session.user = null;
    expect((await GET()).status).toBe(401);
    session.user = { id: "user-a" };
    session.merchant = null;
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns the connected state the page needs — and no token material", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({
      salla_connected: true,
      salla_install_url: "/api/salla/oauth/start",
      salla_connect_mode: "oauth",
      salla_reconnect_required: false,
      salla_store: { id: "777", name: "Bait Al Oud" },
      salla_pending_install: null, // nothing to claim while connected
      channel_status: { instagram: true, whatsapp: true },
      oauth_configured: { meta: true, linkedin: false, x: false, tiktok: true },
      social_oauth_enabled: true
    });
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/enc:v1:|salla-access|salla-refresh|access_token|refresh_token/);
    // channels come from the merchant's own RLS-scoped session
    expect(userDb.calls[0]).toMatchObject({ client: "user", table: "social_channels" });
    expect(userDb.calls[0].filters).toEqual([["eq", "merchant_id", M]]);
    expect(serviceDb.calls).toHaveLength(0);
  });

  it("not connected: offers the confirmed owner's claimable App Store install", async () => {
    session.merchant = merchant({ salla_merchant_id: null, access_token: null, refresh_token: null });
    const body = await (await GET()).json();
    expect(body.salla_connected).toBe(false);
    expect(body.salla_store).toBeNull();
    expect(body.salla_pending_install).toEqual({
      store_id: "9001",
      store_name: "متجر العود",
      store_domain: "https://oud.example",
      authorized_at: pendingRow.authorized_at
    });
    const lookup = serviceDb.calls[0];
    expect(lookup.table).toBe("salla_installs");
    expect(lookup.filters).toEqual(
      expect.arrayContaining([
        ["eq", "owner_email", "owner@example.com"],
        ["eq", "owner_role", "user"]
      ])
    );
  });

  it("never offers an install to an unconfirmed email", async () => {
    session.merchant = merchant({ salla_merchant_id: null, access_token: null });
    session.user = { id: "user-a", email: "owner@example.com", email_confirmed_at: null };
    const body = await (await GET()).json();
    expect(body.salla_pending_install).toBeNull();
    expect(serviceDb.calls).toHaveLength(0);
  });

  it("reports reconnect-needed and uninstalled stores as not connected", async () => {
    session.merchant = merchant({ salla_token_invalid_at: new Date().toISOString() });
    let body = await (await GET()).json();
    expect(body).toMatchObject({ salla_connected: false, salla_reconnect_required: true, salla_store: { id: "777" } });

    session.merchant = merchant({ uninstalled_at: new Date().toISOString() });
    body = await (await GET()).json();
    expect(body).toMatchObject({ salla_connected: false, salla_reconnect_required: false });
  });

  it("points Connect Salla at the App Store whenever an install link is set (listed apps are Easy Mode)", async () => {
    session.merchant = merchant({ salla_merchant_id: null, access_token: null });
    vi.stubEnv("NEXT_PUBLIC_SALLA_INSTALL_URL", "https://s.salla.sa/apps/install/123");
    let body = await (await GET()).json(); // redirect URI also set (it ships pre-filled)
    expect(body).toMatchObject({ salla_install_url: "https://s.salla.sa/apps/install/123", salla_connect_mode: "app_store" });

    vi.stubEnv("SALLA_REDIRECT_URI", "");
    body = await (await GET()).json();
    expect(body).toMatchObject({ salla_connect_mode: "app_store" });
  });

  it("reports Salla as unavailable when neither mode is configured (or the link is not https)", async () => {
    session.merchant = merchant({ salla_merchant_id: null, access_token: null });
    vi.stubEnv("SALLA_REDIRECT_URI", "");
    vi.stubEnv("NEXT_PUBLIC_SALLA_INSTALL_URL", "javascript:alert(1)");
    const body = await (await GET()).json();
    expect(body).toMatchObject({ salla_install_url: null, salla_connect_mode: "unavailable" });
  });

  it("reflects the admin's social switch", async () => {
    features.socialOAuth = false;
    expect((await (await GET()).json()).social_oauth_enabled).toBe(false);
  });

  it("fails honestly (500) when the channel lookup fails", async () => {
    userDb = createFakeSupabase("user", () => ({ error: { code: "57014", message: "timeout" } }));
    expect((await GET()).status).toBe(500);
  });
});
