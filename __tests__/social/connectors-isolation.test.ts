/**
 * Tenant isolation for social publishing: the scheduler builds connectors per
 * merchant, and they must only ever use that merchant's own connected accounts —
 * never platform-wide env tokens (which would publish a merchant's post on the
 * operator's own Instagram / X / LinkedIn / TikTok / WhatsApp).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildConnectorsForMerchant } from "@/lib/social/connectors";
import { encryptSecret } from "@/lib/crypto/secrets";

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

beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-encryption-key-with-enough-length-123456");
  for (const [k, v] of Object.entries(PLATFORM_TOKENS)) vi.stubEnv(k, v);
});
afterEach(() => vi.unstubAllEnvs());

describe("buildConnectorsForMerchant", () => {
  it("returns no connectors for a merchant with no connected accounts, even when platform tokens are configured", () => {
    expect(buildConnectorsForMerchant([])).toEqual([]);
  });

  it("uses only the merchant's own connected accounts", () => {
    const connectors = buildConnectorsForMerchant([
      { platform: "instagram", external_id: "merchant-ig", access_token_encrypted: encryptSecret("merchant-ig-token") },
      { platform: "x", external_id: null, access_token_encrypted: encryptSecret("merchant-x-token") }
    ]);
    expect(connectors.map((c) => c.platform).sort()).toEqual(["instagram", "x"]);
  });

  it("does not fall back to platform tokens when a merchant's channel lacks a token or account id", () => {
    const connectors = buildConnectorsForMerchant([
      { platform: "instagram", external_id: "merchant-ig", access_token_encrypted: null },
      { platform: "linkedin", external_id: null, access_token_encrypted: encryptSecret("merchant-li-token") },
      { platform: "whatsapp", external_id: null, access_token_encrypted: encryptSecret("merchant-wa-token") }
    ]);
    expect(connectors).toEqual([]);
  });
});
