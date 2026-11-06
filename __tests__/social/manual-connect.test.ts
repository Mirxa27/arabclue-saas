/**
 * F34: manual social connect derives the routing account id from the provider using
 * the merchant's own token (never from the client), writes with the service role, and
 * refuses an account another store already owns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, jsonRequest, type FakeHandler, type FakeSupabase } from "../helpers/fake-supabase";
import type { Merchant } from "@/lib/types/database";

const h = vi.hoisted(() => ({
  service: null as unknown as FakeSupabase,
  merchant: null as unknown as Merchant
}));

vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => h.service.client,
  getServerSupabase: async () => {
    throw new Error("social_channels writes must use the service role");
  }
}));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, requireMerchantApi: vi.fn(async () => h.merchant) };
});
vi.mock("@/lib/admin/platform-settings", () => ({
  getFeatureSettings: vi.fn(async () => ({ billing: true, zatca: true, wathq: true, socialOAuth: true }))
}));
vi.mock("@/lib/agents/store-server", () => ({ updateAgentStatus: vi.fn(async () => undefined) }));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import { resolveChannelExternalId } from "@/lib/oauth/channel-identity";
import { POST as connect } from "@/app/api/integrations/social/connect/route";
import { POST as disconnect } from "@/app/api/integrations/social/disconnect/route";
import { HttpError } from "@/lib/api/errors";

let seq = 0;
function merchant(plan: Merchant["plan"] = "plus"): Merchant {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    salla_merchant_id: null,
    salla_state: null,
    store_url: null,
    seller_name: "Store",
    vat_number: null,
    cr_number: null,
    seller_address: null,
    access_token: null,
    refresh_token: null,
    token_expires_at: null,
    plan,
    subscription_status: "active",
    owner_user_id: "u1",
    zatca_csid: null,
    zatca_onboarded_at: null,
    installed_at: null,
    uninstalled_at: null
  };
}

function useService(handler: FakeHandler = () => undefined) {
  h.service = createFakeSupabase("service", handler);
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  h.merchant = merchant();
  useService();
});
afterEach(() => vi.unstubAllGlobals());

describe("resolveChannelExternalId", () => {
  it("returns the id reported by the provider for the token", async () => {
    const resolvers = {
      instagram: vi.fn(async () => "ig-1"),
      whatsapp: vi.fn(async () => "wa-1"),
      tiktok: vi.fn(async () => "tt-1"),
      x: vi.fn(async () => " x-1 "),
      linkedin: vi.fn(async () => "urn:li:organization:1")
    };
    expect(await resolveChannelExternalId("x", "tok", resolvers)).toBe("x-1");
    expect(resolvers.x).toHaveBeenCalledWith("tok");
  });

  it("refuses platforms whose accounts cannot be verified, and invalid tokens", async () => {
    await expect(resolveChannelExternalId("snapchat", "tok")).rejects.toMatchObject({ status: 400, code: "platform_unverifiable" });
    const failing = {
      instagram: async () => {
        throw new Error("Meta pages fetch failed: 401");
      },
      whatsapp: async () => "",
      tiktok: async () => "",
      x: async () => "",
      linkedin: async () => ""
    };
    const err = await resolveChannelExternalId("instagram", "bad", failing).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 400, code: "token_verification_failed" });
    await expect(resolveChannelExternalId("x", "tok", failing)).rejects.toMatchObject({ status: 400 });
  });
});

describe("POST /api/integrations/social/connect", () => {
  const request = (body: unknown) => connect(jsonRequest("http://localhost/api/integrations/social/connect", body));

  it("stores the provider's account id and ignores the client-supplied externalId", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "x-real-42" } }), { status: 200 }));
    const res = await request({ platform: "x", accessToken: "user-access-token-123", externalId: "victim-account" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, platform: "x", externalId: "x-real-42" });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.twitter.com/2/users/me");
    const [upsert] = h.service.writes();
    expect(upsert).toMatchObject({ table: "social_channels", op: "upsert", options: { onConflict: "merchant_id,platform" } });
    expect(upsert.payload).toMatchObject({ merchant_id: h.merchant.id, platform: "x", external_id: "x-real-42" });
  });

  it("rejects a token the provider does not accept", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    const res = await request({ platform: "x", accessToken: "expired-token-xyz" });
    expect(res.status).toBe(400);
    expect(h.service.writes()).toHaveLength(0);
  });

  it("refuses an account that is connected to another store (409)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "x-shared" } }), { status: 200 }));
    useService((call) =>
      call.op === "upsert"
        ? { error: { code: "23505", message: 'duplicate key value violates unique constraint "social_channels_platform_external_id_key"' } }
        : undefined
    );
    const res = await request({ platform: "x", accessToken: "user-access-token-123" });
    expect(res.status).toBe(409);
  });

  it("requires a plan that includes the social module", async () => {
    h.merchant = merchant("lite");
    const res = await request({ platform: "x", accessToken: "user-access-token-123" });
    expect(res.status).toBe(402);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not accept snapchat tokens it cannot verify", async () => {
    const res = await request({ platform: "snapchat", accessToken: "user-access-token-123", externalId: "anything" });
    expect(res.status).toBe(400);
    expect(h.service.writes()).toHaveLength(0);
  });
});

describe("POST /api/integrations/social/disconnect", () => {
  it("deletes the merchant's own channel with the service role", async () => {
    const res = await disconnect(jsonRequest("http://localhost/api/integrations/social/disconnect", { platform: "instagram" }));
    expect(res.status).toBe(200);
    const [del] = h.service.writes();
    expect(del).toMatchObject({ table: "social_channels", op: "delete" });
    expect(h.service.filter(del, "merchant_id")).toBe(h.merchant.id);
  });
});
