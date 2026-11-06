/**
 * SW-22: a Twilio number never outlives its merchant silently.
 *  - account deletion hands the SID to the release queue BEFORE any row is erased (the queue has
 *    no merchant key), tries Twilio at once, and refuses (409, nothing deleted) while a purchase
 *    is in flight;
 *  - a failed release stays queued with backoff and is reported every attempt;
 *  - plan lapse / Salla uninstall release the number after the grace period, and a restored
 *    entitlement cancels the countdown.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeCall, type FakeRpcHandler, type FakeSupabase } from "../helpers/fake-supabase";

vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import { reportError } from "@/lib/observability/error-reporter";
import { eraseMerchantData } from "@/lib/merchant/pdpl";
import {
  drainVoiceNumberReleases,
  releaseBackoffMs,
  RELEASE_GRACE_DAYS,
  sweepLapsedVoiceNumbers,
  type NumberReleaseDeps
} from "@/lib/voice/number-release";
import { runVoiceHousekeeping } from "@/lib/voice/housekeeping";

const MERCHANT_ID = "00000000-0000-4000-8000-0000000009a2";
const NOW = new Date("2026-11-06T12:00:00Z");
const TWILIO = { accountSid: "AC1", authToken: "tok", voiceWebhookUrl: "https://arabclue.test/api/voice/twilio/inbound" };
const DAY = 24 * 3600_000;

function deps(over: Partial<NumberReleaseDeps> = {}): NumberReleaseDeps & { release: ReturnType<typeof vi.fn> } {
  return { release: vi.fn(async () => undefined), twilio: () => TWILIO, now: () => NOW, ...over } as never;
}

let db: FakeSupabase;
function useDb(handler: (c: FakeCall) => unknown = () => undefined, rpc: FakeRpcHandler = () => undefined) {
  db = createFakeSupabase("service", handler as never, rpc);
}

const queued = { outcome: "queued", release_id: "r-1", twilio_sid: "PN-1", phone_number: "+966112345678" };

beforeEach(() => {
  vi.clearAllMocks();
  useDb();
});

describe("account deletion (eraseMerchantData)", () => {
  const merchant = { id: MERCHANT_ID, owner_user_id: "u1", salla_merchant_id: null, cr_number: null };
  const rpcs = (outcome: unknown): FakeRpcHandler => (fn) =>
    fn === "voice_queue_number_release" ? { data: outcome } : fn === "salla_merchant_event_windows" ? { data: [] } : undefined;

  it("queues the number and releases it before anything is erased", async () => {
    const order: string[] = [];
    useDb(
      (c) => {
        if (c.op === "delete") order.push(`delete:${c.table}`);
        if (c.table === "voice_configs" && c.op === "select") return { data: { phone_number: "+966112345678", twilio_incoming_sid: "PN-1", provisioning_started_at: null } };
        return { count: 0 };
      },
      (fn, args) => {
        order.push(`rpc:${fn}`);
        return rpcs(queued)(fn, args);
      }
    );
    const d = deps({ release: vi.fn(async () => void order.push("twilio:release")) as never });
    const report = await eraseMerchantData(db.client, merchant, { voiceNumbers: d });

    expect(report.voiceNumber).toEqual({ queued: true, released: true });
    expect(d.release).toHaveBeenCalledWith(TWILIO, "PN-1");
    expect(db.rpcCalls[0]).toEqual({ fn: "voice_queue_number_release", args: { p_merchant_id: MERCHANT_ID, p_reason: "account_deleted", p_stale_seconds: 600 } });
    expect(order.indexOf("twilio:release")).toBeLessThan(order.indexOf("delete:merchants"));
    expect(order.indexOf("rpc:voice_queue_number_release")).toBeLessThan(order.findIndex((o) => o.startsWith("delete:")));
    const done = db.writes().find((w) => w.table === "voice_number_releases")!;
    expect(done.payload).toMatchObject({ status: "released", attempts: 1, last_error: null });
  });

  it("a Twilio failure does not block the deletion: the SID stays queued (no merchant key) and is reported", async () => {
    useDb(
      (c) => (c.table === "voice_configs" && c.op === "select" ? { data: { phone_number: "+966112345678", twilio_incoming_sid: "PN-1", provisioning_started_at: null } } : { count: 0 }),
      rpcs(queued)
    );
    const d = deps({ release: vi.fn(async () => Promise.reject(new Error("Twilio release failed: 503"))) as never });
    const report = await eraseMerchantData(db.client, merchant, { voiceNumbers: d });
    expect(report.voiceNumber).toEqual({ queued: true, released: false });
    const retry = db.writes().find((w) => w.table === "voice_number_releases")!;
    expect(retry.payload).toMatchObject({ attempts: 1, last_error: "Twilio release failed: 503" });
    expect(Date.parse((retry.payload as { next_attempt_at: string }).next_attempt_at)).toBe(NOW.getTime() + releaseBackoffMs(1));
    expect(vi.mocked(reportError)).toHaveBeenCalled();
    expect(db.writes().some((w) => w.table === "merchants" && w.op === "delete")).toBe(true);
  });

  it("refuses with 409 and deletes nothing while a number purchase is in flight", async () => {
    useDb(
      (c) => (c.table === "voice_configs" && c.op === "select" ? { data: { phone_number: null, twilio_incoming_sid: null, provisioning_started_at: NOW.toISOString() } } : { count: 0 }),
      rpcs({ outcome: "in_progress" })
    );
    await expect(eraseMerchantData(db.client, merchant, { voiceNumbers: deps() })).rejects.toMatchObject({ status: 409, code: "voice_provisioning_in_progress" });
    expect(db.writes().filter((w) => w.op === "delete")).toHaveLength(0);
  });

  it("no number: no queue call at all", async () => {
    useDb(() => ({ count: 0 }), rpcs(queued));
    const report = await eraseMerchantData(db.client, merchant, { voiceNumbers: deps() });
    expect(report.voiceNumber).toEqual({ queued: false, released: false });
    expect(db.rpcCalls.map((r) => r.fn)).toEqual(["salla_merchant_event_windows"]);
  });
});

describe("drainVoiceNumberReleases (cron retries)", () => {
  it("retries due releases; success marks released, failure backs off", async () => {
    useDb((c) =>
      c.table === "voice_number_releases" && c.op === "select"
        ? { data: [{ id: "r-1", twilio_sid: "PN-1", attempts: 0 }, { id: "r-2", twilio_sid: "PN-2", attempts: 3 }] }
        : undefined
    );
    const d = deps({ release: vi.fn(async (_cfg, sid: string) => (sid === "PN-2" ? Promise.reject(new Error("Twilio 500")) : undefined)) as never });
    expect(await drainVoiceNumberReleases(db.client, d)).toEqual({ released: 1, failed: 1 });
    const q = db.calls.find((c) => c.table === "voice_number_releases" && c.op === "select")!;
    expect(q.filters).toEqual(expect.arrayContaining([["eq", "status", "pending"], ["lte", "next_attempt_at", NOW.toISOString()]]));
    const updates = db.writes().filter((w) => w.table === "voice_number_releases");
    expect(updates[0].payload).toMatchObject({ status: "released" });
    expect(updates[1].payload).toMatchObject({ attempts: 4, last_error: "Twilio 500" });
    expect(Date.parse((updates[1].payload as { next_attempt_at: string }).next_attempt_at)).toBe(NOW.getTime() + releaseBackoffMs(4));
    expect(db.writes().find((w) => w.table === "events")!.payload).toMatchObject({ kind: "voice.number_released", merchant: null });
  });

  it("without Twilio credentials the SID stays queued and the failure is visible", async () => {
    useDb((c) => (c.table === "voice_number_releases" && c.op === "select" ? { data: [{ id: "r-1", twilio_sid: "PN-1", attempts: 0 }] } : undefined));
    expect(await drainVoiceNumberReleases(db.client, deps({ twilio: () => null }))).toEqual({ released: 0, failed: 1 });
    expect(db.writes()[0].payload).toMatchObject({ last_error: expect.stringContaining("Twilio is not configured") });
    expect(vi.mocked(reportError)).toHaveBeenCalled();
  });

  it("backoff doubles from 5 minutes and is capped at 12 hours", () => {
    expect(releaseBackoffMs(1)).toBe(5 * 60_000);
    expect(releaseBackoffMs(2)).toBe(10 * 60_000);
    expect(releaseBackoffMs(30)).toBe(12 * 3600_000);
  });
});

describe("sweepLapsedVoiceNumbers (downgrade / expiry / uninstall)", () => {
  const row = (merchant: Record<string, unknown>, entitlement_lost_at: string | null = null, id = MERCHANT_ID) => ({
    merchant_id: id,
    entitlement_lost_at,
    merchants: { plan: "plus", subscription_status: "active", uninstalled_at: null, ...merchant }
  });

  function sweepDb(rows: unknown[]) {
    useDb(
      (c) => (c.table === "voice_configs" && c.op === "select" ? { data: rows } : undefined),
      (fn) => (fn === "voice_queue_number_release" ? { data: queued } : undefined)
    );
  }

  it("a downgrade starts the grace period; nothing is released yet", async () => {
    sweepDb([row({ plan: "lite" })]);
    const report = await sweepLapsedVoiceNumbers(db.client, deps());
    expect(report).toMatchObject({ flagged: 1, queued: 0 });
    expect(db.writes()[0]).toMatchObject({ table: "voice_configs", op: "update", payload: { entitlement_lost_at: NOW.toISOString() } });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it(`after ${RELEASE_GRACE_DAYS} days without voice the number is released (plan_lapsed)`, async () => {
    sweepDb([row({ subscription_status: "canceled" }, new Date(NOW.getTime() - (RELEASE_GRACE_DAYS + 1) * DAY).toISOString())]);
    const d = deps();
    const report = await sweepLapsedVoiceNumbers(db.client, d);
    expect(report).toMatchObject({ queued: 1, released: 1 });
    expect(db.rpcCalls[0]).toMatchObject({ fn: "voice_queue_number_release", args: { p_merchant_id: MERCHANT_ID, p_reason: "plan_lapsed" } });
    expect(d.release).toHaveBeenCalledWith(TWILIO, "PN-1");
  });

  it("an upgrade back within the grace period cancels the countdown", async () => {
    sweepDb([row({ plan: "pro" }, new Date(NOW.getTime() - 3 * DAY).toISOString())]);
    expect(await sweepLapsedVoiceNumbers(db.client, deps())).toMatchObject({ restored: 1, queued: 0 });
    expect(db.writes()[0].payload).toEqual({ entitlement_lost_at: null });
  });

  it("a Salla uninstall not undone within the grace period releases the number (store_uninstalled)", async () => {
    sweepDb([
      row({ uninstalled_at: new Date(NOW.getTime() - (RELEASE_GRACE_DAYS + 2) * DAY).toISOString() }),
      row({ uninstalled_at: new Date(NOW.getTime() - DAY).toISOString() }, null, "00000000-0000-4000-8000-0000000009b2")
    ]);
    const report = await sweepLapsedVoiceNumbers(db.client, deps());
    expect(report.queued).toBe(1);
    expect(db.rpcCalls).toEqual([
      { fn: "voice_queue_number_release", args: { p_merchant_id: MERCHANT_ID, p_reason: "store_uninstalled", p_stale_seconds: 600 } }
    ]);
  });

  it("only looks at configs that hold a number", async () => {
    sweepDb([]);
    await sweepLapsedVoiceNumbers(db.client, deps());
    expect(db.calls[0].filters).toEqual([["not", "phone_number", "is"]]);
  });
});

describe("runVoiceHousekeeping (employees-tick)", () => {
  it("prunes voice records (30 days), sweeps and drains — and never throws", async () => {
    useDb(
      (c) => (c.table === "voice_configs" ? { error: { message: "db down" } } : { data: [] }),
      (fn) => (fn === "prune_voice_records" ? { data: { events: 4, calls: 2, releases: 0 } } : undefined)
    );
    const report = await runVoiceHousekeeping(db.client, deps());
    expect(db.rpcCalls[0]).toEqual({ fn: "prune_voice_records", args: { p_older_than_days: 30 } });
    expect(report.pruned).toEqual({ events: 4, calls: 2, releases: 0 });
    expect(report.lapsed).toBeNull();
    expect(report.releases).toEqual({ released: 0, failed: 0 });
    expect(report.errors).toBe(1);
  });
});
