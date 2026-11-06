/**
 * F21 / UI-004 / UI-014 — the SEO page's routes:
 *  - POST /api/seo/audit audits the merchant's OWN saved store URL (auth, plan, per-merchant
 *    rate limit, daily cap), writes the result with the service role and returns it;
 *  - GET /api/seo/audit returns the latest stored audit through the user's session;
 *  - PUT /api/seo/site validates the store URL (https, public host) and saves it RLS-scoped;
 *  - GET /api/seo lists generated content + products + usage; /api/seo/[id] validates the id,
 *    is merchant-scoped and never echoes database text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, jsonRequest, type FakeCall, type FakeResult, type FakeSupabase } from "../helpers/fake-supabase";
import type { Merchant } from "@/lib/types/database";
import type { FetchedPage } from "@/lib/seo/fetch-page";

const h = vi.hoisted(() => ({
  user: null as unknown as FakeSupabase,
  service: null as unknown as FakeSupabase,
  merchant: null as Merchant | null,
  signedIn: true,
  claimAllowed: true,
  fetched: [] as string[],
  userHandler: (() => undefined) as (call: FakeCall) => FakeResult | undefined,
  serviceHandler: (() => undefined) as (call: FakeCall) => FakeResult | undefined
}));

vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/db/supabase", () => ({
  getServerSupabase: async () => h.user.client,
  getServiceSupabase: () => h.service.client
}));
vi.mock("@/lib/admin/platform-settings", () => ({
  getAgentSettings: vi.fn(async () => ({
    social: { enabled: true, cronMinutes: 15, maxPostsPerRun: 50 },
    voice: { enabled: true, defaultDialect: "khaliji" },
    seo: { enabled: true, model: "gpt-4o-mini", residency: "global" }
  }))
}));
vi.mock("@/lib/seo/fetch-page", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/seo/fetch-page")>();
  return {
    ...actual,
    fetchPublicPage: vi.fn(async (url: string): Promise<FetchedPage> => {
      h.fetched.push(url);
      return {
        requestedUrl: url,
        finalUrl: url,
        status: 200,
        contentType: "text/html",
        html: `<html lang="ar" dir="rtl"><head><title>x</title></head><body></body></html>`,
        truncated: false,
        redirects: [],
        xRobotsTag: null
      };
    })
  };
});
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  const { HttpError } = await import("@/lib/api/errors");
  return {
    ...actual,
    requireMerchantApi: vi.fn(async () => {
      if (!h.signedIn) throw new actual.AuthError();
      if (!h.merchant) throw new HttpError(403, "Complete onboarding first", "merchant_required");
      return h.merchant;
    })
  };
});

import { GET as getAudit, POST as runAudit } from "@/app/api/seo/audit/route";
import { PUT as putSite } from "@/app/api/seo/site/route";
import { GET as listSeo } from "@/app/api/seo/route";
import { DELETE as deleteItem, GET as getItem } from "@/app/api/seo/[id]/route";

let seq = 0;
function merchant(overrides: Partial<Merchant> = {}): Merchant {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    salla_merchant_id: null,
    store_url: "https://bayt-oud.example/",
    seller_name: "Store",
    vat_number: null,
    cr_number: null,
    seller_address: null,
    token_expires_at: null,
    plan: "plus",
    subscription_status: "active",
    owner_user_id: "u1",
    zatca_onboarded_at: null,
    installed_at: null,
    uninstalled_at: null,
    ...overrides
  };
}

beforeEach(() => {
  h.signedIn = true;
  h.merchant = merchant();
  h.claimAllowed = true;
  h.fetched = [];
  h.userHandler = () => undefined;
  h.serviceHandler = () => undefined;
  h.user = createFakeSupabase("user", (call) => {
    const forced = h.userHandler(call);
    if (forced) return forced;
    if (call.table === "salla_products") {
      return {
        data: [
          { url: "https://bayt-oud.example/p/1" },
          { url: "https://evil.example/p/2" },
          { url: "http://bayt-oud.example/p/3" },
          { url: "https://www.bayt-oud.example/p/4" }
        ]
      };
    }
    return undefined;
  });
  h.service = createFakeSupabase(
    "service",
    (call) => {
      const forced = h.serviceHandler(call);
      if (forced) return forced;
      if (call.table === "seo_site_audits" && call.op === "insert") return { data: { id: "a-1", created_at: "2026-11-06T09:00:00Z" } };
      if (call.table === "seo_site_audits" && call.op === "select") return { data: [] };
      return undefined;
    },
    (fn) => (fn === "claim_merchant_usage" ? { data: { allowed: h.claimAllowed, used: 1, limit: 30 } } : { data: 0 })
  );
});

const post = (ip = "203.0.113.10") =>
  runAudit(new NextRequest("http://localhost/api/seo/audit", { method: "POST", headers: { "x-forwarded-for": ip } }));

describe("POST /api/seo/audit", () => {
  it("401 / 403 / 402 before any fetch", async () => {
    h.signedIn = false;
    expect((await post()).status).toBe(401);
    h.signedIn = true;
    h.merchant = null;
    expect((await post()).status).toBe(403);
    h.merchant = merchant({ plan: "lite" });
    expect((await post()).status).toBe(402);
    expect(h.fetched).toEqual([]);
  });

  it("409 when no store URL is saved", async () => {
    h.merchant = merchant({ store_url: null });
    const res = await post();
    expect(res.status).toBe(409);
    expect(h.fetched).toEqual([]);
  });

  it("refuses a store URL written directly through the Data API that is not a public https site", async () => {
    for (const bad of ["http://bayt-oud.example/", "https://169.254.169.254/", "https://localhost/", "https://bayt-oud.example:8080/"]) {
      h.merchant = merchant({ store_url: bad });
      expect((await post()).status).toBe(400);
    }
    expect(h.fetched).toEqual([]);
    expect(h.service.rpcCalls).toEqual([]);
  });

  it("audits the saved store + same-site product pages and stores the result with the service role", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    const { audit } = await res.json();
    expect(h.fetched).toEqual(["https://bayt-oud.example/", "https://bayt-oud.example/p/1", "https://www.bayt-oud.example/p/4"]);
    expect(audit).toMatchObject({ id: "a-1", saved: true, url: "https://bayt-oud.example/", audited_at: "2026-11-06T09:00:00Z" });
    expect(audit.issues.length).toBeGreaterThan(0);
    const insert = h.service.writes().find((w) => w.table === "seo_site_audits" && w.op === "insert")!;
    expect(insert.client).toBe("service");
    expect(insert.payload).toMatchObject({ merchant_id: h.merchant!.id, url: "https://bayt-oud.example/" });
    expect(h.user.writes()).toEqual([]);
    expect(h.service.rpcCalls[0]).toMatchObject({ fn: "claim_merchant_usage", args: { p_metric: "seo.audit", p_limit: 30 } });
  });

  it("429 when the daily audit cap is used up — nothing is fetched", async () => {
    h.claimAllowed = false;
    expect((await post()).status).toBe(429);
    expect(h.fetched).toEqual([]);
  });

  it("rate-limits per merchant (5 per 10 minutes) across IPs", async () => {
    for (let i = 0; i < 5; i += 1) expect((await post(`198.51.100.${i}`)).status).toBe(200);
    expect((await post("192.0.2.9")).status).toBe(429);
  });

  it("still returns the measured audit when storing it failed, marked saved:false", async () => {
    h.serviceHandler = (call) => (call.table === "seo_site_audits" && call.op === "insert" ? { error: { message: "disk full" } } : undefined);
    const res = await post();
    expect(res.status).toBe(200);
    const { audit } = await res.json();
    expect(audit.saved).toBe(false);
    expect(JSON.stringify(audit)).not.toContain("disk full");
  });
});

describe("GET /api/seo/audit", () => {
  it("returns the saved store URL and the latest audit read through the user's session", async () => {
    h.userHandler = (call) =>
      call.table === "seo_site_audits"
        ? { data: { id: "a-9", url: "https://bayt-oud.example/", pages: [], issues: [], summary: { critical: 0, warning: 0, info: 0, pages: 1 }, created_at: "2026-11-05T09:00:00Z" } }
        : undefined;
    const res = await getAudit();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.store_url).toBe("https://bayt-oud.example/");
    expect(json.audit).toMatchObject({ id: "a-9", audited_at: "2026-11-05T09:00:00Z", saved: true });
    const read = h.user.calls.find((c) => c.table === "seo_site_audits")!;
    expect(h.user.filter(read, "merchant_id")).toBe(h.merchant!.id);
  });

  it("null audit before the first run", async () => {
    const json = await (await getAudit()).json();
    expect(json.audit).toBeNull();
  });
});

describe("PUT /api/seo/site", () => {
  const put = (body: unknown) => putSite(jsonRequest("http://localhost/api/seo/site", body, { method: "PUT" }));

  it("normalises and saves a public https store URL through the user's session", async () => {
    h.userHandler = (call) => (call.table === "merchants" && call.op === "update" ? { data: { store_url: "https://bayt-oud.example/ar" } } : undefined);
    const res = await put({ store_url: "  bayt-oud.example/ar#top " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ store_url: "https://bayt-oud.example/ar" });
    const [update] = h.user.writes();
    expect(update).toMatchObject({ client: "user", table: "merchants", op: "update", payload: { store_url: "https://bayt-oud.example/ar" } });
    expect(h.user.filter(update, "id")).toBe(h.merchant!.id);
  });

  it.each([
    ["http://bayt-oud.example/"],
    ["https://127.0.0.1/"],
    ["https://localhost/"],
    ["https://shop.internal/"],
    ["https://user:pw@bayt-oud.example/"],
    ["https://bayt-oud.example:8443/"],
    ["not a url"],
    [""]
  ])("400 for %j", async (url) => {
    const res = await put({ store_url: url });
    expect(res.status).toBe(400);
    expect(h.user.writes()).toEqual([]);
  });

  it("400 for an oversized body field", async () => {
    expect((await put({ store_url: `https://x.example/${"a".repeat(3000)}` })).status).toBe(400);
  });
});

describe("GET /api/seo", () => {
  it("lists the merchant's content and products with usage and gates", async () => {
    h.userHandler = (call) => {
      if (call.table === "seo_content") return { data: [{ id: "c-1", kind: "blog", ref_id: "s", payload: { title: "t" }, published: false, created_at: "x" }] };
      if (call.table === "salla_products") return { data: [{ salla_product_id: "p-1", name: "Oud", arabic_name: "عود" }] };
      return undefined;
    };
    h.serviceHandler = (call) => (call.table === "merchant_usage_counters" ? { data: { used: 7 } } : undefined);
    const res = await listSeo();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toHaveLength(1);
    expect(json.products).toEqual([{ id: "p-1", name: "عود" }]);
    expect(json.usage).toMatchObject({ used: 7, limit: 100 });
    expect(json.entitled).toBe(true);
    expect(json.agent_enabled).toBe(true);
    const contentRead = h.user.calls.find((c) => c.table === "seo_content")!;
    expect(h.user.filter(contentRead, "merchant_id")).toBe(h.merchant!.id);
  });
});

describe("/api/seo/[id]", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const ID = "22222222-2222-4222-8222-222222222222";

  it("400 for a non-uuid id (no database text leaks)", async () => {
    const res = await getItem(new NextRequest("http://localhost/api/seo/ranks"), ctx("ranks"));
    expect(res.status).toBe(400);
    expect(h.user.calls).toEqual([]);
  });

  it("404 when the item is not the merchant's", async () => {
    const res = await getItem(new NextRequest(`http://localhost/api/seo/${ID}`), ctx(ID));
    expect(res.status).toBe(404);
    const read = h.user.calls[0];
    expect(h.user.filter(read, "merchant_id")).toBe(h.merchant!.id);
  });

  it("500 without the raw database message when the read fails", async () => {
    h.userHandler = () => ({ error: { code: "XX000", message: "relation seo_content does not exist at character 15" } });
    const res = await getItem(new NextRequest(`http://localhost/api/seo/${ID}`), ctx(ID));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("relation");
  });

  it("deletes only the merchant's row and 404s when nothing matched", async () => {
    h.userHandler = (call) => (call.op === "delete" ? { data: [{ id: ID }] } : undefined);
    const ok = await deleteItem(new NextRequest(`http://localhost/api/seo/${ID}`, { method: "DELETE" }), ctx(ID));
    expect(ok.status).toBe(200);
    const del = h.user.writes()[0];
    expect(h.user.filter(del, "id")).toBe(ID);
    expect(h.user.filter(del, "merchant_id")).toBe(h.merchant!.id);

    h.userHandler = (call) => (call.op === "delete" ? { data: [] } : undefined);
    const missing = await deleteItem(new NextRequest(`http://localhost/api/seo/${ID}`, { method: "DELETE" }), ctx(ID));
    expect(missing.status).toBe(404);
  });
});
