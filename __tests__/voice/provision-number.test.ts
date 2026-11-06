/**
 * F35: number provisioning is reserved atomically before anything is bought, capped,
 * aborts a replacement when the old number cannot be released, and never leaves a
 * reservation (or an unrecorded paid number) behind on failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, jsonRequest, type FakeHandler, type FakeRpcHandler, type FakeSupabase } from "../helpers/fake-supabase";
import type { Merchant } from "@/lib/types/database";

const h = vi.hoisted(() => ({
  service: null as unknown as FakeSupabase,
  merchant: null as unknown as Merchant,
  twilio: null as null | { accountSid: string; authToken: string; voiceWebhookUrl: string }
}));

vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => h.service.client,
  getServerSupabase: async () => {
    throw new Error("provisioning must use the service role");
  }
}));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, requireMerchantApi: vi.fn(async () => h.merchant) };
});
vi.mock("@/lib/admin/platform-settings", () => ({
  getAgentSettings: vi.fn(async () => ({ voice: { enabled: true, defaultDialect: "khaliji" } }))
}));
vi.mock("@/lib/voice/twilio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voice/twilio")>();
  return { ...actual, getTwilioConfig: () => h.twilio };
});
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import { provisionMerchantVoiceNumber, MAX_NUMBERS_PER_DAY, type TwilioNumberOps } from "@/lib/voice/twilio-provisioning";
import { POST } from "@/app/api/voice/provision-number/route";

const MERCHANT_ID = "00000000-0000-4000-8000-0000000000a2";
const TWILIO = { accountSid: "AC1", authToken: "tok", voiceWebhookUrl: "https://example.test/api/voice/twilio/inbound" };

function useService(rpc: FakeRpcHandler, handler: FakeHandler = () => undefined) {
  h.service = createFakeSupabase("service", handler, rpc);
}

function ops(over: Partial<TwilioNumberOps> = {}): TwilioNumberOps & { provision: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> } {
  return {
    provision: vi.fn(async () => ({ sid: "PN-NEW", phoneNumber: "+966500000123" })),
    release: vi.fn(async () => undefined),
    ...over
  } as never;
}

const claimed = (phone: string | null = null, sid: string | null = null) => () => ({
  data: { outcome: "claimed", phone_number: phone, twilio_incoming_sid: sid }
});

const reservationCleared = () =>
  h.service.writes().some(
    (w) => w.table === "voice_configs" && (w.payload as Record<string, unknown>).provisioning_started_at === null
  );

beforeEach(() => {
  h.twilio = TWILIO;
  process.env.VOICE_BRIDGE_WS_URL = "wss://bridge.arabclue.test/stream";
  process.env.VOICE_BRIDGE_SECRET = "bridge-secret-0123456789";
});
afterEach(() => {
  delete process.env.VOICE_BRIDGE_WS_URL;
  delete process.env.VOICE_BRIDGE_SECRET;
  vi.unstubAllGlobals();
});

describe("provisionMerchantVoiceNumber", () => {
  it("reserves first, buys exactly one number, records it and clears the reservation", async () => {
    useService(claimed());
    const twilio = ops();
    const result = await provisionMerchantVoiceNumber(h.service.client, TWILIO, MERCHANT_ID, { replace: false }, twilio);

    expect(result).toEqual({ status: "provisioned", phoneNumber: "+966500000123", sid: "PN-NEW", replaced: false });
    expect(h.service.rpcCalls[0]).toEqual({
      fn: "claim_voice_number_provisioning",
      args: { p_merchant_id: MERCHANT_ID, p_replace: false, p_stale_seconds: 600, p_max_per_day: MAX_NUMBERS_PER_DAY }
    });
    expect(twilio.provision).toHaveBeenCalledTimes(1);
    expect(twilio.release).not.toHaveBeenCalled();
    const [save, event] = h.service.writes();
    expect(save).toMatchObject({ table: "voice_configs", op: "update" });
    expect(save.payload).toMatchObject({ phone_number: "+966500000123", twilio_incoming_sid: "PN-NEW", enabled: true, provisioning_started_at: null });
    expect(event).toMatchObject({ table: "events", op: "insert" });
    expect(event.payload).toMatchObject({ kind: "voice.number_provisioned", merchant: MERCHANT_ID });
  });

  it("does not buy while another request holds the reservation (409)", async () => {
    useService(() => ({ data: { outcome: "in_progress" } }));
    const twilio = ops();
    await expect(provisionMerchantVoiceNumber(h.service.client, TWILIO, MERCHANT_ID, { replace: false }, twilio)).rejects.toMatchObject({ status: 409 });
    expect(twilio.provision).not.toHaveBeenCalled();
  });

  it("returns the existing number without buying", async () => {
    useService(() => ({ data: { outcome: "already_provisioned", phone_number: "+966500000001" } }));
    const twilio = ops();
    expect(await provisionMerchantVoiceNumber(h.service.client, TWILIO, MERCHANT_ID, { replace: false }, twilio)).toEqual({
      status: "already_provisioned",
      phoneNumber: "+966500000001"
    });
    expect(twilio.provision).not.toHaveBeenCalled();
  });

  it("enforces the daily cap (429)", async () => {
    useService(() => ({ data: { outcome: "rate_limited", provisioned_last_24h: 3 } }));
    const twilio = ops();
    await expect(provisionMerchantVoiceNumber(h.service.client, TWILIO, MERCHANT_ID, { replace: true }, twilio)).rejects.toMatchObject({ status: 429 });
    expect(twilio.provision).not.toHaveBeenCalled();
  });

  it("aborts a replacement when the old number cannot be released — nothing is bought", async () => {
    useService(claimed("+966500000001", "PN-OLD"));
    const twilio = ops({ release: vi.fn(async () => Promise.reject(new Error("Twilio release failed: 500"))) });
    await expect(provisionMerchantVoiceNumber(h.service.client, TWILIO, MERCHANT_ID, { replace: true }, twilio)).rejects.toMatchObject({
      status: 502,
      code: "release_failed"
    });
    expect(twilio.provision).not.toHaveBeenCalled();
    expect(reservationCleared()).toBe(true);
  });

  it("releases the old number before buying the replacement", async () => {
    useService(claimed("+966500000001", "PN-OLD"));
    const order: string[] = [];
    const twilio = ops({
      release: vi.fn(async (_cfg, sid: string) => {
        order.push(`release:${sid}`);
      }),
      provision: vi.fn(async () => {
        order.push("provision");
        return { sid: "PN-NEW", phoneNumber: "+966500000123" };
      })
    });
    const result = await provisionMerchantVoiceNumber(h.service.client, TWILIO, MERCHANT_ID, { replace: true }, twilio);
    expect(order).toEqual(["release:PN-OLD", "provision"]);
    expect(result).toMatchObject({ status: "provisioned", replaced: true });
  });

  it("clears the reservation when the purchase fails", async () => {
    useService(claimed());
    const twilio = ops({ provision: vi.fn(async () => Promise.reject(new Error("No available Twilio numbers in SA"))) });
    await expect(provisionMerchantVoiceNumber(h.service.client, TWILIO, MERCHANT_ID, { replace: false }, twilio)).rejects.toMatchObject({ status: 502 });
    expect(reservationCleared()).toBe(true);
  });

  it("releases a number bought for a store deleted meanwhile (the save matched no row) — SW-22", async () => {
    useService(claimed(), (call) =>
      call.table === "voice_configs" && call.op === "update" && (call.payload as Record<string, unknown>).twilio_incoming_sid === "PN-NEW"
        ? { data: [] }
        : undefined
    );
    const twilio = ops();
    await expect(provisionMerchantVoiceNumber(h.service.client, TWILIO, MERCHANT_ID, { replace: false }, twilio)).rejects.toMatchObject({
      status: 409,
      code: "merchant_gone"
    });
    expect(twilio.release).toHaveBeenCalledWith(TWILIO, "PN-NEW");
    expect(h.service.writes().some((w) => w.table === "events")).toBe(false);
  });

  it("queues an unrecorded number for the release cron when Twilio refuses the immediate release", async () => {
    useService(claimed(), (call) => {
      if (call.table === "voice_configs" && call.op === "update" && (call.payload as Record<string, unknown>).twilio_incoming_sid === "PN-NEW") {
        return { data: [] };
      }
      if (call.table === "voice_number_releases") return { data: { id: "r1", twilio_sid: "PN-NEW", attempts: 0 } };
      return undefined;
    });
    const twilio = ops({ release: vi.fn(async () => Promise.reject(new Error("Twilio release failed: 503"))) });
    await expect(provisionMerchantVoiceNumber(h.service.client, TWILIO, MERCHANT_ID, { replace: false }, twilio)).rejects.toMatchObject({ status: 409 });
    const queued = h.service.writes().find((w) => w.table === "voice_number_releases");
    expect(queued).toMatchObject({ op: "upsert", options: { onConflict: "twilio_sid" } });
    expect(queued!.payload).toEqual({ twilio_sid: "PN-NEW", phone_number: "+966500000123", reason: "unrecorded_purchase" });
  });

  it("releases a purchased number that could not be recorded", async () => {
    useService(claimed(), (call) =>
      call.table === "voice_configs" && (call.payload as Record<string, unknown>).twilio_incoming_sid === "PN-NEW"
        ? { error: { code: "23505", message: "duplicate key value violates unique constraint voice_configs_phone_number_key" } }
        : undefined
    );
    const twilio = ops();
    await expect(provisionMerchantVoiceNumber(h.service.client, TWILIO, MERCHANT_ID, { replace: false }, twilio)).rejects.toMatchObject({ status: 500 });
    expect(twilio.release).toHaveBeenCalledWith(TWILIO, "PN-NEW");
    expect(reservationCleared()).toBe(true);
  });
});

describe("POST /api/voice/provision-number", () => {
  const base = (plan: Merchant["plan"], id: string): Merchant => ({
    id,
    salla_merchant_id: null,
    store_url: null,
    seller_name: "Store",
    vat_number: null,
    cr_number: null,
    seller_address: null,
    token_expires_at: null,
    plan,
    subscription_status: "active",
    owner_user_id: "u1",
    zatca_onboarded_at: null,
    installed_at: null,
    uninstalled_at: null
  });
  const request = () => POST(jsonRequest("http://localhost/api/voice/provision-number", {}));

  it("requires the voice module (402) and a Twilio configuration (503)", async () => {
    h.merchant = base("lite", "00000000-0000-4000-8000-0000000000f1");
    useService(() => undefined);
    expect((await request()).status).toBe(402);
    h.merchant = base("plus", "00000000-0000-4000-8000-0000000000f2");
    h.twilio = null;
    expect((await request()).status).toBe(503);
    expect(h.service.rpcCalls).toHaveLength(0);
  });

  it("SW-42: refuses (503, coded) before any reservation or purchase when the media bridge is not configured", async () => {
    h.merchant = base("plus", "00000000-0000-4000-8000-0000000000f5");
    useService(() => ({ data: { outcome: "claimed", phone_number: null, twilio_incoming_sid: null } }));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const unset of [["VOICE_BRIDGE_WS_URL"], ["VOICE_BRIDGE_SECRET"]]) {
      process.env.VOICE_BRIDGE_WS_URL = "wss://bridge.arabclue.test/stream";
      process.env.VOICE_BRIDGE_SECRET = "bridge-secret-0123456789";
      for (const k of unset) delete process.env[k];
      const res = await request();
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: "voice_bridge_not_configured" });
    }
    // a non-wss stream URL is not a bridge Twilio can use
    process.env.VOICE_BRIDGE_WS_URL = "http://bridge.arabclue.test/stream";
    expect((await request()).status).toBe(503);
    expect(h.service.rpcCalls).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps a concurrent reservation to 409", async () => {
    h.merchant = base("plus", "00000000-0000-4000-8000-0000000000f3");
    useService(() => ({ data: { outcome: "in_progress" } }));
    expect((await request()).status).toBe(409);
  });

  it("burst-limits per merchant regardless of IP", async () => {
    h.merchant = base("plus", "00000000-0000-4000-8000-0000000000f4");
    useService(() => ({ data: { outcome: "already_provisioned", phone_number: "+966500000001" } }));
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await POST(
        jsonRequest("http://localhost/api/voice/provision-number", {}, { headers: { "x-forwarded-for": `198.51.100.${i}` } })
      );
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });
});
