/**
 * RB-S2 — Salla app lifecycle webhooks are applied in Salla's event order, not delivery order.
 * A retried / late app.uninstalled used to wipe the tokens of a newer reinstall, and a late older
 * app.store.authorize brought back revoked tokens. Both now go through SQL functions that take the
 * per-store lock and compare the event's created_at (Salla wall clock, Asia/Riyadh) with the
 * newest applied authorization / uninstall (salla_record_uninstall, salla_apply_authorization —
 * semantics in supabase/tests/82_salla_lifecycle_ordering.test.sql).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";
import authorizeEvent from "../fixtures/salla-app-store-authorize.json";
import uninstalledEvent from "../fixtures/salla-app-uninstalled.json";
import userInfo from "../fixtures/salla-user-info.json";

vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

const state = vi.hoisted(() => ({
  uninstall: { outcome: "uninstalled", merchant_id: "m-1" } as Record<string, unknown>,
  authorize: { outcome: "linked_updated", merchant_id: "m-1" } as Record<string, unknown>
}));
let service = createFakeSupabase("service");

vi.mock("@/lib/db/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/supabase")>()),
  getServiceSupabase: () => service.client
}));

import { POST } from "@/app/api/salla/webhook/route";
import { sallaEventTime } from "@/lib/salla/app-events";

const SECRET = "salla-webhook-secret-for-tests";

function signed(payload: unknown) {
  const raw = JSON.stringify(payload);
  return new NextRequest("http://localhost:3111/api/salla/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-salla-signature": createHmac("sha256", SECRET).update(raw).digest("hex") },
    body: raw
  });
}

const rpc = (fn: string) => service.rpcCalls.find((c) => c.fn === fn);
const events = () => service.calls.filter((c: FakeCall) => c.table === "events" && c.op === "insert").map((c) => c.payload as { kind: string; payload: Record<string, unknown> });

beforeEach(() => {
  vi.stubEnv("SALLA_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-token-encryption-key-32-chars-min");
  state.uninstall = { outcome: "uninstalled", merchant_id: "m-1" };
  state.authorize = { outcome: "linked_updated", merchant_id: "m-1" };
  service = createFakeSupabase(
    "service",
    () => ({ data: null, error: null }),
    (fn) => {
      if (fn === "claim_webhook_event") return { data: "new" };
      if (fn === "salla_record_uninstall") return { data: state.uninstall };
      if (fn === "salla_apply_authorization") return { data: state.authorize };
      throw new Error(`unexpected rpc ${fn}`);
    }
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ ...userInfo, data: { ...userInfo.data, merchant: { ...userInfo.data.merchant, id: authorizeEvent.merchant } } }), { status: 200 })
    )
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sallaEventTime", () => {
  it("reads Salla's created_at as Asia/Riyadh wall-clock time", () => {
    expect(sallaEventTime("2022-12-31 12:31:25")).toBe("2022-12-31T09:31:25.000Z");
    expect(sallaEventTime("2022-12-31T12:31:25")).toBe("2022-12-31T09:31:25.000Z");
  });

  it("is null when the time is missing or not a date", () => {
    expect(sallaEventTime(undefined)).toBeNull();
    expect(sallaEventTime("yesterday")).toBeNull();
    expect(sallaEventTime("2022-02-30 10:00:00")).toBeNull();
  });
});

describe("app.uninstalled", () => {
  it("is applied by salla_record_uninstall with the event's time — no direct token wipe", async () => {
    expect((await POST(signed(uninstalledEvent))).status).toBe(200);
    expect(rpc("salla_record_uninstall")?.args).toEqual({
      p_salla_merchant_id: String(uninstalledEvent.merchant),
      p_event_at: "2022-12-31T09:31:25.000Z"
    });
    expect(service.calls.filter((c) => c.table === "merchants" && c.op === "update")).toHaveLength(0);
    expect(service.calls.filter((c) => c.table === "salla_installs")).toHaveLength(0);
    expect(events().map((e) => e.kind)).toEqual(["salla.uninstalled"]);
    expect(events()[0].payload).toMatchObject({ outcome: "uninstalled", event: "app.uninstalled" });
  });

  it("a late uninstall older than the stored authorization is acknowledged and logged as stale", async () => {
    state.uninstall = { outcome: "stale" };
    const res = await POST(signed(uninstalledEvent));
    expect(res.status).toBe(200);
    expect(events()[0].payload).toMatchObject({ outcome: "stale" });
  });

  it("passes a null event time when created_at is absent (applied as before, unordered)", async () => {
    const { created_at: _omit, ...withoutTime } = uninstalledEvent;
    await POST(signed(withoutTime));
    expect(rpc("salla_record_uninstall")?.args).toMatchObject({ p_event_at: null });
  });
});

describe("app.store.authorize", () => {
  it("is applied by salla_apply_authorization with the event's time", async () => {
    expect((await POST(signed(authorizeEvent))).status).toBe(200);
    const args = rpc("salla_apply_authorization")?.args;
    expect(args).toMatchObject({ p_salla_merchant_id: String(authorizeEvent.merchant), p_event_at: "2022-12-31T09:31:25.000Z" });
    expect(String(args?.p_access_token)).toMatch(/^enc:v1:/);
  });

  it("a late authorization older than a processed uninstall is reported stale (tokens not restored)", async () => {
    state.authorize = { outcome: "stale" };
    expect((await POST(signed(authorizeEvent))).status).toBe(200);
    expect(events()[0]).toMatchObject({ kind: "salla.app.store.authorize", payload: expect.objectContaining({ outcome: "stale" }) });
  });
});
