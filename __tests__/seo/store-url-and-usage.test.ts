/**
 * Small pure pieces behind the SEO / Wathq / topbar work:
 *  - store URL normalisation (F21): https only, default port, no credentials, fragment dropped;
 *  - usage-counter periods in Asia/Riyadh and the claim/release RPC mapping (SW-25 / SW-26);
 *  - the topbar's merchant display name from real columns (UI-017).
 */
import { describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "../helpers/fake-supabase";

const reportError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/error-reporter", () => ({ reportError }));

import { normalizeStoreUrl } from "@/lib/seo/store-url";
import { claimUsage, releaseUsage, riyadhDate, riyadhMonthStart } from "@/lib/usage/counters";
import { merchantDisplayName } from "@/lib/merchant/display-name";

describe("normalizeStoreUrl", () => {
  it.each([
    ["bayt-oud.example", "https://bayt-oud.example/"],
    ["  https://Bayt-Oud.example/ar?x=1#top ", "https://bayt-oud.example/ar?x=1"],
    ["https://salla.sa/bayt-oud", "https://salla.sa/bayt-oud"],
    ["https://bayt-oud.example:443/", "https://bayt-oud.example/"]
  ])("%j → %s", (raw, url) => {
    expect(normalizeStoreUrl(raw)).toEqual({ ok: true, url });
  });

  it.each([
    ["", "empty"],
    ["http://bayt-oud.example/", "https_required"],
    ["ftp://bayt-oud.example/", "https_required"],
    ["https://user:pw@bayt-oud.example/", "credentials"],
    ["https://bayt-oud.example:8443/", "port"],
    ["https://localhost/", "invalid"],
    ["https://", "invalid"],
    [`https://x.example/${"a".repeat(2100)}`, "too_long"]
  ])("%j is refused (%s) with a bilingual message", (raw, code) => {
    const res = normalizeStoreUrl(raw);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe(code);
      expect(res.message.ar && res.message.en).toBeTruthy();
    }
  });
});

describe("usage counter periods (Asia/Riyadh, UTC+3)", () => {
  it("rolls the day and month over at Riyadh midnight", () => {
    expect(riyadhDate(new Date("2026-10-31T20:59:59Z"))).toBe("2026-10-31");
    expect(riyadhDate(new Date("2026-10-31T21:00:00Z"))).toBe("2026-11-01");
    expect(riyadhMonthStart(new Date("2026-10-31T20:59:59Z"))).toBe("2026-10-01");
    expect(riyadhMonthStart(new Date("2026-10-31T21:00:00Z"))).toBe("2026-11-01");
  });
});

describe("claimUsage / releaseUsage", () => {
  it("maps the RPC outcome", async () => {
    const sb = createFakeSupabase("service", undefined, () => ({ data: { allowed: false, used: 100, limit: 100 } }));
    const claim = await claimUsage(sb.client, { merchantId: "m", metric: "seo.generation", periodStart: "2026-11-01", limit: 100 });
    expect(claim).toEqual({ allowed: false, used: 100, limit: 100, periodStart: "2026-11-01" });
    expect(sb.rpcCalls[0]).toEqual({
      fn: "claim_merchant_usage",
      args: { p_merchant_id: "m", p_metric: "seo.generation", p_period_start: "2026-11-01", p_limit: 100 }
    });
  });

  it("an unreadable counter fails closed (503) instead of allowing unmetered spend", async () => {
    const sb = createFakeSupabase("service", undefined, () => ({ error: { message: "connection refused" } }));
    await expect(claimUsage(sb.client, { merchantId: "m", metric: "wathq.lookup", periodStart: "2026-11-06", limit: 500 })).rejects.toMatchObject({
      status: 503,
      code: "usage_unavailable"
    });
  });

  it("release never throws; a failure is reported", async () => {
    const sb = createFakeSupabase("service", undefined, () => ({ error: { message: "nope" } }));
    await expect(releaseUsage(sb.client, { merchantId: "m", metric: "seo.audit", periodStart: "2026-11-06" })).resolves.toBeUndefined();
    expect(reportError).toHaveBeenCalled();
  });
});

describe("merchantDisplayName (topbar identity)", () => {
  it("uses seller_name, then the Salla store name, then the store host", () => {
    expect(merchantDisplayName({ seller_name: " بيت العود ", salla_store_name: "S", store_url: null })).toBe("بيت العود");
    expect(merchantDisplayName({ seller_name: "", salla_store_name: "Salla Store", store_url: null })).toBe("Salla Store");
    expect(merchantDisplayName({ seller_name: null, salla_store_name: null, store_url: "https://www.bayt-oud.example/ar?x" })).toBe(
      "bayt-oud.example"
    );
    expect(merchantDisplayName(null)).toBe("");
  });
});
