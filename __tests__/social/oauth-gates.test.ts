/**
 * SW-11 / SW-13: social account connects honour the plan and the admin's "Social OAuth" kill
 * switch (start routes + callback persistence), never re-enable a paused agent, and leave the
 * shared OAuth helpers ungated for Salla (a Lite feature: ZATCA).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeSupabase } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({
  socialOAuth: true,
  merchant: null as null | { id: string; owner_user_id: string; plan: string; subscription_status: string },
  service: null as unknown as FakeSupabase,
  dbMerchant: null as null | { plan: string; subscription_status: string },
  agentRowExists: false
}));

vi.mock("@/lib/admin/platform-settings", () => ({
  getFeatureSettings: vi.fn(async () => ({ billing: true, zatca: true, wathq: true, socialOAuth: h.socialOAuth }))
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getSessionContext: vi.fn(async () => ({ user: h.merchant ? { id: h.merchant.owner_user_id } : null, merchant: h.merchant }))
}));
vi.mock("@/lib/db/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/supabase")>()),
  getServiceSupabase: () => h.service.client
}));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import { GET as xStart } from "@/app/api/oauth/x/start/route";
import { GET as linkedinStart } from "@/app/api/oauth/linkedin/start/route";
import { GET as tiktokStart } from "@/app/api/oauth/tiktok/start/route";
import { GET as metaStart } from "@/app/api/oauth/meta/start/route";
import { GET as sallaStart } from "@/app/api/salla/oauth/start/route";
import { persistSocialConnection } from "@/lib/oauth/flow";
import { enableSocialAgentOnFirstConnect } from "@/lib/social/gates";

const SITE = "http://localhost:3111";
let ip = 0;
const get = (handler: (req: NextRequest) => Promise<Response>, path: string) =>
  handler(new NextRequest(`${SITE}${path}`, { headers: { "x-forwarded-for": `198.51.100.${(ip = (ip % 250) + 1)}` } }));

function signIn(plan: string, status = "active") {
  h.merchant = { id: "aaaaaaaa-0000-4000-8000-00000000000a", owner_user_id: "user-a", plan, subscription_status: status };
  h.dbMerchant = { plan, subscription_status: status };
}

beforeEach(() => {
  h.socialOAuth = true;
  h.agentRowExists = false;
  signIn("plus");
  h.service = createFakeSupabase("service", (call: FakeCall) => {
    if (call.table === "merchants") return { data: h.dbMerchant };
    if (call.table === "agent_settings" && call.op === "upsert") return { data: h.agentRowExists ? [] : [{ id: "row" }] };
    if (call.table === "social_channels") return { error: null };
    return undefined;
  });
  for (const [k, v] of Object.entries({
    OAUTH_STATE_SECRET: "test-oauth-state-secret-at-least-32-chars",
    TOKEN_ENCRYPTION_KEY: "test-token-encryption-key-32-chars-min",
    NEXT_PUBLIC_SITE_URL: SITE,
    X_CLIENT_ID: "x-id",
    LINKEDIN_CLIENT_ID: "li-id",
    TIKTOK_CLIENT_KEY: "tt-key",
    META_APP_ID: "meta-id",
    SALLA_CLIENT_ID: "salla-id",
    SALLA_CLIENT_SECRET: "salla-secret",
    SALLA_REDIRECT_URI: `${SITE}/api/salla/oauth/callback`
  })) vi.stubEnv(k, v);
});
afterEach(() => vi.unstubAllEnvs());

const STARTS = [
  ["x", xStart, "/api/oauth/x/start"],
  ["linkedin", linkedinStart, "/api/oauth/linkedin/start"],
  ["tiktok", tiktokStart, "/api/oauth/tiktok/start"],
  ["instagram", metaStart, "/api/oauth/meta/start?target=instagram"],
  ["whatsapp", metaStart, "/api/oauth/meta/start?target=whatsapp"]
] as const;

describe("social OAuth start routes", () => {
  it.each(STARTS)("%s: a Lite merchant is refused with plan_required (no state, no cookie)", async (platform, handler, path) => {
    signIn("lite");
    const res = await get(handler, path);
    expect(res.headers.get("location")).toBe(`/integrations/callback?platform=${platform}&status=error&error=plan_required`);
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/ac_oauth_/);
  });

  it.each(STARTS)("%s: the admin kill switch refuses with social_disabled", async (platform, handler, path) => {
    h.socialOAuth = false;
    const res = await get(handler, path);
    expect(res.headers.get("location")).toBe(`/integrations/callback?platform=${platform}&status=error&error=social_disabled`);
  });

  it("an unpaid (pending) Plus merchant is refused; a past_due one is in its grace period", async () => {
    signIn("plus", "pending");
    expect((await get(xStart, "/api/oauth/x/start")).headers.get("location")).toContain("error=plan_required");
    signIn("pro", "past_due");
    expect((await get(xStart, "/api/oauth/x/start")).headers.get("location")).toMatch(/^https:\/\/twitter\.com\/i\/oauth2\/authorize/);
  });

  it("Salla connect (ZATCA, a Lite feature) is not gated by the social switches", async () => {
    signIn("lite");
    h.socialOAuth = false;
    const res = await get(sallaStart, "/api/salla/oauth/start");
    expect(res.headers.get("location")).toMatch(/^https:\/\/accounts\.salla\.sa\/oauth2\/auth/);
  });
});

describe("social OAuth callback persistence", () => {
  const persist = () =>
    persistSocialConnection({
      merchantId: "aaaaaaaa-0000-4000-8000-00000000000a",
      platform: "x",
      tokens: { accessToken: "x-access", refreshToken: "x-refresh", expiresIn: 7200 },
      resolveExternalId: async () => "x-user-1"
    });

  it("re-checks the kill switch and the plan (they can change while the merchant is on the provider's page)", async () => {
    h.socialOAuth = false;
    await expect(persist()).rejects.toMatchObject({ code: "social_disabled" });
    h.socialOAuth = true;
    h.dbMerchant = { plan: "plus", subscription_status: "canceled" };
    await expect(persist()).rejects.toMatchObject({ code: "plan_required" });
    expect(h.service.writes().filter((w) => w.table === "social_channels")).toHaveLength(0);
  });

  it("a reconnect never switches a paused agent back on (insert-only enable)", async () => {
    h.agentRowExists = true; // the merchant has a row (e.g. enabled=false after pressing Stop)
    await persist();
    const upsert = h.service.writes().find((w) => w.table === "agent_settings")!;
    expect(upsert.options).toMatchObject({ onConflict: "merchant_id,persona_role", ignoreDuplicates: true });
    expect(h.service.writes().filter((w) => w.table === "agent_settings" && w.op === "update")).toHaveLength(0);
    await expect(enableSocialAgentOnFirstConnect("aaaaaaaa-0000-4000-8000-00000000000a")).resolves.toBe("kept");
  });

  it("a first connect by an entitled merchant switches the agent on", async () => {
    await expect(enableSocialAgentOnFirstConnect("aaaaaaaa-0000-4000-8000-00000000000a")).resolves.toBe("created");
    const upsert = h.service.writes().find((w) => w.table === "agent_settings")!;
    expect(upsert.payload).toMatchObject({ persona_role: "social", enabled: true, status: "active" });
    h.dbMerchant = { plan: "lite", subscription_status: "active" };
    await expect(enableSocialAgentOnFirstConnect("aaaaaaaa-0000-4000-8000-00000000000a")).resolves.toBe("not_entitled");
  });
});
