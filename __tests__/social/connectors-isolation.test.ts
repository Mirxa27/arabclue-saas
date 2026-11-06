/**
 * Tenant isolation + token handling of the per-merchant publishers: they only ever use the
 * merchant's own connected accounts — never platform-wide env tokens (which would publish a
 * merchant's post on the operator's own Instagram / X / LinkedIn) — and they refresh X tokens
 * once on a 401 (SW-27).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "../helpers/fake-supabase";
import { buildMerchantPublishers } from "@/lib/social/publishers";
import { encryptSecret } from "@/lib/crypto/secrets";
import type { ChannelRow } from "@/lib/social/token-refresh";
import type { PublishPayload } from "@/lib/social/types";

const PLATFORM_TOKENS = {
  META_IG_USER_ID: "1789",
  META_PAGE_ACCESS_TOKEN: "EAAG-platform",
  X_BEARER: "x-platform",
  LINKEDIN_ACTOR_URN: "urn:li:organization:1",
  LINKEDIN_ACCESS_TOKEN: "li-platform",
  TIKTOK_ACCESS_TOKEN: "tt-platform",
  WHATSAPP_PHONE_ID: "555",
  WHATSAPP_ACCESS_TOKEN: "wa-platform"
};

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-encryption-key-with-enough-length-123456");
  for (const [k, v] of Object.entries(PLATFORM_TOKENS)) vi.stubEnv(k, v);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function channel(platform: string, overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: `ch-${platform}`,
    merchant_id: "m1",
    platform,
    external_id: `${platform}-account`,
    access_token_encrypted: encryptSecret(`${platform}-merchant-token`),
    refresh_token_encrypted: null,
    token_expires_at: null,
    token_invalid_at: null,
    ...overrides
  };
}

const payload: PublishPayload = {
  copy: { caption: "مرحبا", altText: "", cta: "", hashtags: [] },
  images: [{ url: "https://cdn.salla.sa/a.jpg" }]
};

describe("buildMerchantPublishers", () => {
  it("offers nothing for a merchant with no connected accounts, even when platform tokens are configured", () => {
    const pubs = buildMerchantPublishers(createFakeSupabase("service").client, []);
    for (const platform of ["instagram", "x", "linkedin"] as const) {
      expect(pubs.get(platform)).toMatchObject({ available: false, code: "not_connected" });
    }
    for (const platform of ["tiktok", "whatsapp", "snapchat"] as const) {
      expect(pubs.get(platform)).toMatchObject({ available: false, code: "unsupported" });
    }
  });

  it("publishes with the merchant's own account and token only", async () => {
    const pubs = buildMerchantPublishers(createFakeSupabase("service").client, [channel("x"), channel("instagram")]);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "t1" } }), { status: 201 }));
    const x = pubs.get("x")!;
    expect(x.available).toBe(true);
    if (x.available) await x.publish(payload);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.x.com/2/tweets");
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer x-merchant-token");

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "c" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "m" }), { status: 200 }));
    const ig = pubs.get("instagram")!;
    if (ig.available) await ig.publish(payload);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/instagram-account/media");
    expect(JSON.stringify(fetchMock.mock.calls.map((c) => c[1]))).not.toMatch(/platform/);
  });

  it("does not fall back to platform tokens when a channel lacks a token or account id, and reports revoked ones", () => {
    const pubs = buildMerchantPublishers(createFakeSupabase("service").client, [
      channel("instagram", { access_token_encrypted: null }),
      channel("linkedin", { external_id: null }),
      channel("x", { token_invalid_at: "2026-11-01T00:00:00Z" })
    ]);
    expect(pubs.get("instagram")).toMatchObject({ available: false, code: "not_connected" });
    expect(pubs.get("linkedin")).toMatchObject({ available: false, code: "reconnect_required" });
    expect(pubs.get("x")).toMatchObject({ available: false, code: "reconnect_required" });
  });

  it("refreshes an X token once after a 401 and retries the post once", async () => {
    const sb = createFakeSupabase("service", (call) => {
      if (call.table === "social_channels" && call.op === "select") {
        return { data: { ...channel("x", { refresh_token_encrypted: encryptSecret("rt") }) } };
      }
      if (call.table === "social_channels" && call.op === "update") return { data: [{ id: "ch-x" }] };
      return undefined;
    }, (fn) => (fn === "social_claim_token_refresh" ? { data: "lease-1" } : undefined));
    const refresher = vi.fn(async () => ({ accessToken: "fresh-token", refreshToken: "rt2", expiresIn: 7200 }));
    const pubs = buildMerchantPublishers(sb.client, [channel("x", { refresh_token_encrypted: encryptSecret("rt") })], {
      tokenOptions: { refreshers: { x: refresher } }
    });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ title: "Unauthorized" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "t2" } }), { status: 201 }));
    const x = pubs.get("x")!;
    await expect(x.available ? x.publish(payload) : Promise.reject(new Error("unavailable"))).resolves.toEqual({ remoteId: "t2" });
    expect(refresher).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[1][1]!.headers as Record<string, string>).authorization).toBe("Bearer fresh-token");
  });

  it("flags a LinkedIn channel for reconnection when LinkedIn rejects its token (no refresh path)", async () => {
    const sb = createFakeSupabase("service");
    const pubs = buildMerchantPublishers(sb.client, [channel("linkedin")]);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: "Invalid access token" }), { status: 401 }));
    const li = pubs.get("linkedin")!;
    await expect(li.available ? li.publish(payload) : Promise.resolve()).rejects.toMatchObject({ code: "reconnect_required" });
    const marker = sb.writes().find((c) => c.table === "social_channels" && c.op === "update");
    expect(marker?.payload).toHaveProperty("token_invalid_at");
    expect(marker?.filters.map(([, column]) => column)).toEqual(["id", "access_token_encrypted"]);
  });
});
