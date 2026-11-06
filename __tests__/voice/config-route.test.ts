/**
 * GET / PATCH / POST /api/voice/config (UI-005, SW-41, SW-8, SW-42):
 *  - GET answers the settings, the honest line state and what the platform has configured;
 *  - PATCH (and POST) write only the keys sent — saving knowledge never resets `enabled` or the
 *    dialect — with bounded sizes, a normalised E.164 hand-over number and unknown keys refused;
 *  - switching on needs the platform switch, the plan and the media bridge; switching off always
 *    works; every write is scoped to the session's merchant on the service role.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, jsonRequest, type FakeCall, type FakeSupabase } from "../helpers/fake-supabase";
import type { Merchant } from "@/lib/types/database";

const h = vi.hoisted(() => ({
  service: null as unknown as FakeSupabase,
  user: null as unknown as FakeSupabase,
  merchant: null as unknown as Merchant | null,
  agents: { voice: { enabled: true, defaultDialect: "khaliji" } } as { voice: { enabled: boolean; defaultDialect: string } }
}));

vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => h.service.client,
  getServerSupabase: async () => h.user.client
}));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    requireMerchantApi: vi.fn(async () => {
      if (!h.merchant) throw new actual.AuthError();
      return h.merchant;
    })
  };
});
vi.mock("@/lib/admin/platform-settings", () => ({ getAgentSettings: vi.fn(async () => h.agents) }));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import { GET, PATCH, POST } from "@/app/api/voice/config/route";
import { VOICE_ERROR_MESSAGES } from "@/lib/voice/messages";
import { settingsPatch } from "@/lib/voice/settings-draft";

const MERCHANT_ID = "00000000-0000-4000-8000-0000000007a2";

const merchant = (plan: Merchant["plan"] = "plus", status: Merchant["subscription_status"] = "active"): Merchant => ({
  id: MERCHANT_ID,
  salla_merchant_id: null,
  store_url: null,
  seller_name: "Store",
  vat_number: null,
  cr_number: null,
  seller_address: null,
  token_expires_at: null,
  plan,
  subscription_status: status,
  owner_user_id: "u1",
  zatca_onboarded_at: null,
  installed_at: null,
  uninstalled_at: null
});

const savedRow = {
  merchant_id: MERCHANT_ID,
  enabled: true,
  dialect: "msa",
  hours: "9-5",
  escalation_phone: "+966551110000",
  knowledge: "old",
  phone_number: "+966112345678",
  provisioning_started_at: null,
  updated_at: "2026-11-06T09:00:00Z"
};

function clients(row: Record<string, unknown> | null = savedRow) {
  h.service = createFakeSupabase("service", (c: FakeCall) =>
    c.table === "voice_configs" && c.op === "upsert" ? { data: { ...row, ...(c.payload as object) } } : undefined
  );
  h.user = createFakeSupabase("user", (c: FakeCall) => (c.table === "voice_configs" ? { data: row } : undefined));
}

const patch = (body: unknown, method: "PATCH" | "POST" = "PATCH") =>
  (method === "PATCH" ? PATCH : POST)(jsonRequest("http://localhost/api/voice/config", body, { method }));

const upserts = () => h.service.writes().filter((w) => w.table === "voice_configs");

beforeEach(() => {
  h.merchant = merchant();
  h.agents = { voice: { enabled: true, defaultDialect: "khaliji" } };
  process.env.VOICE_BRIDGE_WS_URL = "wss://bridge.arabclue.test/stream";
  process.env.VOICE_BRIDGE_SECRET = "bridge-secret-0123456789";
  process.env.TWILIO_ACCOUNT_SID = "AC1";
  process.env.TWILIO_AUTH_TOKEN = "tok";
  process.env.NEXT_PUBLIC_SITE_URL = "https://arabclue.test";
  clients();
});
afterEach(() => {
  for (const k of ["VOICE_BRIDGE_WS_URL", "VOICE_BRIDGE_SECRET", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "NEXT_PUBLIC_SITE_URL"]) {
    delete process.env[k];
  }
});

describe("GET /api/voice/config", () => {
  it("returns the settings, the line state and the platform availability (merchant session, RLS)", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config).toMatchObject({ enabled: true, dialect: "msa", effectiveDialect: "msa", phone_number: "+966112345678", provisioning: false });
    expect(body.state).toBe("active");
    expect(body.availability).toEqual({
      entitled: true,
      platformEnabled: true,
      bridgeConfigured: true,
      twilioConfigured: true,
      defaultDialect: "khaliji"
    });
    expect(body.limits).toEqual({ hours: 200, knowledge: 4000 });
    expect(h.user.calls.map((c) => c.table)).toContain("voice_configs");
    expect(h.service.writes()).toHaveLength(0);
  });

  it("never claims calls are handled without a number", async () => {
    clients({ ...savedRow, phone_number: null });
    const body = await (await GET()).json();
    expect(body.state).toBe("needs_number");
    expect(body.reasons).toContain("number_missing");
  });

  it("explains a lite plan, the kill switch and a missing bridge", async () => {
    h.merchant = merchant("lite");
    delete process.env.VOICE_BRIDGE_WS_URL;
    h.agents = { voice: { enabled: false, defaultDialect: "english" } };
    const body = await (await GET()).json();
    expect(body.state).toBe("unavailable");
    expect(body.reasons).toEqual(expect.arrayContaining(["platform_disabled", "plan_required", "bridge_not_configured"]));
    expect(body.availability.defaultDialect).toBe("english");
  });

  it("a merchant without a config row gets defaults (off, platform dialect)", async () => {
    clients(null);
    const body = await (await GET()).json();
    expect(body.config).toMatchObject({ enabled: false, dialect: null, effectiveDialect: "khaliji", phone_number: null });
    expect(body.state).toBe("paused");
  });

  it("401 without a session", async () => {
    h.merchant = null;
    expect((await GET()).status).toBe(401);
  });
});

describe("PATCH /api/voice/config — partial update (SW-41)", () => {
  it("saving knowledge writes only knowledge: enabled and dialect are not reset", async () => {
    const res = await patch({ knowledge: "returns within 7 days" });
    expect(res.status).toBe(200);
    const [upsert] = upserts();
    expect(upsert).toMatchObject({ client: "service", op: "upsert", options: { onConflict: "merchant_id" } });
    expect(Object.keys(upsert.payload as object).sort()).toEqual(["knowledge", "merchant_id", "updated_at"]);
    expect(upsert.payload).toMatchObject({ merchant_id: MERCHANT_ID, knowledge: "returns within 7 days" });
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, config: { enabled: true, dialect: "msa" } });
  });

  it("POST has the same partial semantics (no more defaults)", async () => {
    await patch({ hours: "9-5" }, "POST");
    expect(Object.keys(upserts()[0].payload as object).sort()).toEqual(["hours", "merchant_id", "updated_at"]);
  });

  it("bounds sizes and refuses unknown keys (e.g. phone_number, merchant_id)", async () => {
    expect((await patch({ knowledge: "x".repeat(4001) })).status).toBe(400);
    expect((await patch({ hours: "x".repeat(201) })).status).toBe(400);
    expect((await patch({ phone_number: "+966500000002" })).status).toBe(400);
    expect((await patch({ merchant_id: "00000000-0000-4000-8000-0000000000b2", hours: "x" })).status).toBe(400);
    expect((await patch({ dialect: "klingon" })).status).toBe(400);
    expect(upserts()).toHaveLength(0);
  });

  it("normalises the hand-over number to E.164 and rejects one that cannot be dialled", async () => {
    await patch({ escalation_phone: "٠٥٥ ١١١ ٠٠٠٠" });
    expect(upserts()[0].payload).toMatchObject({ escalation_phone: "+966551110000" });
    const bad = await patch({ escalation_phone: "call me" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "invalid_escalation_phone" });
  });

  it("clears with null / empty string and returns the dialect to the platform default", async () => {
    await patch({ knowledge: "", dialect: null, escalation_phone: null });
    expect(upserts()[0].payload).toMatchObject({ knowledge: null, dialect: null, escalation_phone: null });
  });

  it("an empty patch is a coded 400", async () => {
    const res = await patch({});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "nothing_to_update" });
  });

  it("invalid JSON is a 400", async () => {
    const res = await PATCH(
      new (await import("next/server")).NextRequest("http://localhost/api/voice/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{nope"
      })
    );
    expect(res.status).toBe(400);
  });
});

describe("the on/off switch (SW-8, SW-42)", () => {
  it("a lite merchant cannot switch the agent on (402, coded, no write)", async () => {
    h.merchant = merchant("lite");
    const res = await patch({ enabled: true });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe("plan_required");
    expect(body.error).toContain(VOICE_ERROR_MESSAGES.plan_required.ar);
    expect(upserts()).toHaveLength(0);
  });

  it("a pending subscription cannot either, nor edit settings", async () => {
    h.merchant = merchant("pro", "pending");
    expect((await patch({ enabled: true })).status).toBe(402);
    expect((await patch({ knowledge: "x" })).status).toBe(402);
    expect(upserts()).toHaveLength(0);
  });

  it("503 while the platform switch is off", async () => {
    h.agents = { voice: { enabled: false, defaultDialect: "khaliji" } };
    const res = await patch({ enabled: true });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "voice_platform_disabled" });
  });

  it("503 when the media bridge is not configured — the line is never 'on' while calls cannot connect", async () => {
    delete process.env.VOICE_BRIDGE_SECRET;
    const res = await patch({ enabled: true });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "voice_bridge_not_configured" });
    expect(upserts()).toHaveLength(0);
  });

  it("switching off always works — downgraded plan, kill switch, no bridge", async () => {
    h.merchant = merchant("lite", "canceled");
    h.agents = { voice: { enabled: false, defaultDialect: "khaliji" } };
    delete process.env.VOICE_BRIDGE_WS_URL;
    const res = await patch({ enabled: false });
    expect(res.status).toBe(200);
    expect(upserts()[0].payload).toMatchObject({ merchant_id: MERCHANT_ID, enabled: false });
    expect(Object.keys(upserts()[0].payload as object).sort()).toEqual(["enabled", "merchant_id", "updated_at"]);
  });

  it("an entitled merchant switches on through the service role", async () => {
    const res = await patch({ enabled: true });
    expect(res.status).toBe(200);
    expect(upserts()[0]).toMatchObject({ client: "service", payload: { merchant_id: MERCHANT_ID, enabled: true } });
    expect(h.user.writes()).toHaveLength(0);
  });
});

describe("settings form diff (lib/voice/settings-draft.ts)", () => {
  const saved = {
    enabled: true,
    dialect: "msa" as const,
    effectiveDialect: "msa" as const,
    hours: "9-5",
    escalation_phone: "+966551110000",
    knowledge: "old",
    phone_number: null,
    provisioning: false,
    updated_at: null
  };
  it("sends only what changed; empty fields clear", () => {
    expect(settingsPatch(saved, { dialect: "msa", hours: "9-5", escalation_phone: "+966551110000", knowledge: "old" })).toEqual({});
    expect(settingsPatch(saved, { dialect: "msa", hours: "9-5 ", escalation_phone: "+966551110000", knowledge: "new" })).toEqual({ knowledge: "new" });
    expect(settingsPatch(saved, { dialect: "", hours: "", escalation_phone: "+966551110000", knowledge: "old" })).toEqual({ dialect: null, hours: null });
  });
});
