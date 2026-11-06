/**
 * F13 / UI-007: persona agent toggles live in agent_settings (not ai_employees), GET
 * never crashes on unknown roles, a fresh merchant still gets every agent to toggle,
 * and switching an agent on requires the plan feature.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, jsonRequest, type FakeHandler, type FakeSupabase } from "../helpers/fake-supabase";
import type { Merchant } from "@/lib/types/database";

const h = vi.hoisted(() => ({
  service: null as unknown as FakeSupabase,
  user: null as unknown as FakeSupabase,
  merchant: null as unknown as Merchant | null
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
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import {
  AGENT_ROLES,
  AgentPatchSchema,
  buildAgentEntries,
  nextAgentSetting,
  type AgentSettingRow
} from "@/lib/agents/settings";
import { hydrateAgentState } from "@/lib/agents/store";
import { updateAgentStatus } from "@/lib/agents/store-server";
import { GET, PATCH } from "@/app/api/agents/status/route";

const MERCHANT_ID = "00000000-0000-4000-8000-0000000000a2";

function merchant(plan: Merchant["plan"], status: Merchant["subscription_status"]): Merchant {
  return {
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
  };
}

const row = (over: Partial<AgentSettingRow>): AgentSettingRow => ({
  persona_role: "social",
  enabled: true,
  status: "active",
  last_error: null,
  overrides: {},
  updated_at: "2026-11-06T10:00:00Z",
  ...over
});

function useClients(service: FakeHandler = () => undefined, user: FakeHandler = () => undefined) {
  h.service = createFakeSupabase("service", service);
  h.user = createFakeSupabase("user", user);
}

beforeEach(() => {
  h.merchant = merchant("plus", "active");
  useClients();
});

describe("buildAgentEntries", () => {
  it("returns every persona agent, switched off, for a merchant without rows", () => {
    const entries = buildAgentEntries([]);
    expect(entries.map((e) => e.role)).toEqual([...AGENT_ROLES]);
    expect(entries.every((e) => !e.enabled && e.status === "idle")).toBe(true);
    expect(entries.find((e) => e.role === "social")!.persona.name).toBeTruthy();
  });

  it("skips rows whose role has no persona instead of throwing, and applies overrides", () => {
    const entries = buildAgentEntries([
      row({ persona_role: "sales-rep" }),
      row({ persona_role: "voice", overrides: { display_name: "Salem 2", tone: "friendly", junk: 1 } })
    ]);
    expect(entries).toHaveLength(AGENT_ROLES.length);
    const voice = entries.find((e) => e.role === "voice")!;
    expect(voice).toMatchObject({ enabled: true, status: "active", overrides: { display_name: "Salem 2", tone: "friendly" } });
    expect(voice.persona.name).toBe("Salem 2");
    expect(voice.overrides).not.toHaveProperty("junk");
  });
});

describe("nextAgentSetting", () => {
  it("derives status from enabled, keeps other fields, clears a stale error on toggle", () => {
    expect(nextAgentSetting(null, AgentPatchSchema.parse({ role: "seo", enabled: true }))).toMatchObject({ enabled: true, status: "active" });
    expect(
      nextAgentSetting(row({ status: "error", last_error: "boom" }), AgentPatchSchema.parse({ role: "social", enabled: false }))
    ).toMatchObject({ enabled: false, status: "idle", last_error: null });
    expect(
      nextAgentSetting(row({ overrides: { tone: "formal" } }), AgentPatchSchema.parse({ role: "social", overrides: { display_name: "Noura" } }))
    ).toMatchObject({ enabled: true, status: "active", overrides: { tone: "formal", display_name: "Noura" } });
  });

  it("rejects a contradictory patch", () => {
    expect(AgentPatchSchema.safeParse({ role: "social", enabled: false, status: "active" }).success).toBe(false);
    expect(AgentPatchSchema.safeParse({ role: "sales-rep", enabled: true }).success).toBe(false);
  });
});

describe("hydrateAgentState (hooks/use-agents)", () => {
  it("merges API rows over the defaults so every agent stays toggleable", () => {
    const state = hydrateAgentState([
      { role: "voice", enabled: true, status: "active", overrides: { display_name: "Salem" } },
      { role: "not-a-persona", enabled: true }
    ]);
    expect(Object.keys(state.agents)).toEqual(["social", "voice", "seo", "sales", "support", "analyst"]);
    expect(state.agents.voice).toMatchObject({ enabled: true, status: "active", overrides: { display_name: "Salem" } });
    expect(state.agents.social).toMatchObject({ enabled: false, status: "idle" });
  });
});

describe("GET /api/agents/status", () => {
  it("reads agent_settings through the merchant's own session", async () => {
    useClients(undefined, (call) => (call.table === "agent_settings" ? { data: [row({ persona_role: "seo" })] } : undefined));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agents: Array<{ role: string; enabled: boolean }> };
    expect(body.agents).toHaveLength(6);
    expect(body.agents.find((a) => a.role === "seo")!.enabled).toBe(true);
    expect(h.user.calls[0]).toMatchObject({ table: "agent_settings", op: "select" });
    // merchant data through the session (RLS); the service role only reads the platform switches
    // (the voice card reflects the agents.voice kill switch — SW-21, lib/voice/agent-state.ts)
    expect(h.service.calls.map((c) => c.table)).toEqual(["platform_settings"]);
    expect(h.service.writes()).toHaveLength(0);
  });

  it("returns a JSON 401 without a session", async () => {
    h.merchant = null;
    expect((await GET()).status).toBe(401);
  });
});

describe("PATCH /api/agents/status", () => {
  const patch = (body: unknown) => PATCH(jsonRequest("http://localhost/api/agents/status", body, { method: "PATCH" }));

  it("refuses to switch an agent on when the plan does not include it (402, no write)", async () => {
    h.merchant = merchant("lite", "active");
    const res = await patch({ role: "social", enabled: true, status: "active" });
    expect(res.status).toBe(402);
    expect(h.service.writes()).toHaveLength(0);
  });

  it("refuses when the subscription is not paid", async () => {
    h.merchant = merchant("pro", "pending");
    expect((await patch({ role: "voice", enabled: true })).status).toBe(402);
  });

  it("upserts agent_settings on the service role for an entitled merchant", async () => {
    useClients((call) => (call.op === "upsert" ? { data: row({ persona_role: "social", ...(call.payload as object) }) } : undefined));
    const res = await patch({ role: "social", enabled: true, status: "active" });
    expect(res.status).toBe(200);
    const upsert = h.service.writes()[0];
    expect(upsert).toMatchObject({ table: "agent_settings", op: "upsert", options: { onConflict: "merchant_id,persona_role" } });
    expect(upsert.payload).toMatchObject({ merchant_id: MERCHANT_ID, persona_role: "social", enabled: true, status: "active" });
    expect(((await res.json()) as { agent: { enabled: boolean } }).agent.enabled).toBe(true);
  });

  it("always lets a merchant switch an agent off", async () => {
    h.merchant = merchant("lite", "canceled");
    useClients((call) => (call.op === "upsert" ? { data: row({ enabled: false, status: "idle" }) } : undefined));
    expect((await patch({ role: "social", enabled: false, status: "idle" })).status).toBe(200);
  });
});

describe("updateAgentStatus (OAuth callbacks)", () => {
  it("writes agent_settings, not the ai_employees marketplace table", async () => {
    // entitled merchant (plan gate: __tests__/agents/oauth-plan-gate.test.ts)
    useClients((call) => (call.table === "merchants" ? { data: { plan: "plus", subscription_status: "active" } } : undefined));
    await expect(updateAgentStatus(MERCHANT_ID, "social", true)).resolves.toBe(true);
    const [upsert] = h.service.writes();
    expect(upsert.table).toBe("agent_settings");
    expect(upsert.options).toEqual({ onConflict: "merchant_id,persona_role" });
  });
});
