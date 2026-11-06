import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeCall, type FakeSupabase } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({ sb: null as unknown as FakeSupabase }));
vi.mock("@/lib/db/supabase", () => ({ getServiceSupabase: () => h.sb.client }));
vi.mock("@/lib/observability/error-reporter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/observability/error-reporter")>();
  return { ...actual, reportError: vi.fn() };
});

import { loadEmployeeIntegrations, markIntegrationError, touchIntegrationLastEvent } from "@/lib/employees/integration-store";
import {
  INBOUND_REJECTION_COPY,
  inboundRejectionCopy,
  INTEGRATION_ERROR_COPY,
  readIntegrationError
} from "@/lib/employees/integration-errors";
import { reportError } from "@/lib/observability/error-reporter";

const EMP = "88888888-8888-4888-8888-888888888888";

beforeEach(() => vi.clearAllMocks());

describe("loadEmployeeIntegrations", () => {
  it("loads several kinds and statuses in one query, decrypting credentials", async () => {
    h.sb = createFakeSupabase("service", () => ({
      data: [{ id: "i1", kind: "meta", status: "error", credentials: { page_id: "1" }, config: null }]
    }));
    const rows = await loadEmployeeIntegrations(EMP, ["meta", "instagram"], { statuses: ["connected", "error"] });
    expect(rows).toEqual([{ id: "i1", kind: "meta", status: "error", credentials: { page_id: "1" }, config: {} }]);
    expect(h.sb.calls).toHaveLength(1);
    expect(h.sb.calls[0].filters).toEqual([
      ["eq", "employee_id", EMP],
      ["in", "kind", ["meta", "instagram"]],
      ["in", "status", ["connected", "error"]]
    ]);
  });

  it("throws on a DB error (webhooks answer 5xx so the provider retries)", async () => {
    h.sb = createFakeSupabase("service", () => ({ error: { message: "connection refused" } }));
    await expect(loadEmployeeIntegrations(EMP, ["meta"])).rejects.toThrow(/connection refused/);
  });
});

describe("markIntegrationError", () => {
  it("flips a connected row to error, merging the reason into config", async () => {
    h.sb = createFakeSupabase("service", (call: FakeCall) =>
      call.op === "select" ? { data: { id: "int-1", config: { page_name: "Store", connected_via: "manual" } } } : undefined
    );
    const ok = await markIntegrationError(EMP, "meta", {
      reason: "token_invalid",
      source: "send",
      graph_code: 190,
      detail: "Error validating access token: Bearer EAAsecrettoken12345",
      at: "2026-11-06T10:00:00.000Z"
    });
    expect(ok).toBe(true);
    const update = h.sb.calls.find((c) => c.op === "update");
    expect(update?.filters).toEqual([
      ["eq", "id", "int-1"],
      ["eq", "status", "connected"]
    ]);
    const payload = update?.payload as { status: string; config: { page_name: string; error: { reason: string; detail: string } } };
    expect(payload.status).toBe("error");
    expect(payload.config.page_name).toBe("Store");
    expect(payload.config.error.reason).toBe("token_invalid");
    expect(payload.config.error.detail).not.toContain("EAAsecrettoken12345"); // redacted
  });

  it("does nothing when no connected row exists, and never throws", async () => {
    h.sb = createFakeSupabase("service", () => ({ data: null }));
    expect(await markIntegrationError(EMP, "meta", { reason: "token_invalid", source: "send", at: "x" })).toBe(false);
    h.sb = createFakeSupabase("service", () => ({ error: { message: "db down" } }));
    expect(await markIntegrationError(EMP, "meta", { reason: "token_invalid", source: "send", at: "x" })).toBe(false);
    expect(reportError).toHaveBeenCalled();
  });
});

describe("touchIntegrationLastEvent", () => {
  it("updates last_event_at for the given rows only", async () => {
    h.sb = createFakeSupabase("service");
    await touchIntegrationLastEvent([]);
    expect(h.sb.calls).toHaveLength(0);
    await touchIntegrationLastEvent(["a", "b"]);
    expect(h.sb.calls[0]).toMatchObject({ op: "update", filters: [["in", "id", ["a", "b"]]] });
  });
});

describe("integration error contract (workspace copy)", () => {
  it("has Arabic and English copy for every reason", () => {
    for (const copy of Object.values(INTEGRATION_ERROR_COPY)) {
      expect(copy.ar).toMatch(/[؀-ۿ]/);
      expect(copy.en.length).toBeGreaterThan(10);
    }
  });

  it("reads config.error defensively", () => {
    expect(readIntegrationError({ error: { reason: "token_invalid", source: "send", at: "t", graph_code: 190 } })).toEqual({
      reason: "token_invalid",
      source: "send",
      graph_code: 190,
      at: "t"
    });
    expect(readIntegrationError({ error: { reason: "made_up", at: "t" } })).toBeNull();
    expect(readIntegrationError({})).toBeNull();
    expect(readIntegrationError(null)).toBeNull();
  });
});

describe("refused inbound deliveries (activity copy)", () => {
  it("has Arabic and English copy for every reason the inbound routes record", () => {
    for (const copy of Object.values(INBOUND_REJECTION_COPY)) {
      expect(copy.ar).toMatch(/[؀-ۿ]/);
      expect(copy.en.length).toBeGreaterThan(10);
    }
    // Every reason logged by lib/employees/inbound/* has copy (the parameter type enforces it too).
    for (const reason of ["no_app_secret", "signature_mismatch", "no_signing_secret", "no_webhook_secret", "no_auth_token"]) {
      expect(INBOUND_REJECTION_COPY).toHaveProperty(reason);
    }
  });

  it("maps an inbound_rejected activity row to its fixed copy, nothing else", () => {
    expect(inboundRejectionCopy({ action: "inbound_rejected", result: { reason: "signature_mismatch" } })).toEqual({
      reason: "signature_mismatch",
      ...INBOUND_REJECTION_COPY.signature_mismatch
    });
    expect(inboundRejectionCopy({ action: "inbound_rejected", result: { reason: "<b>made up</b>" } })).toBeNull();
    expect(inboundRejectionCopy({ action: "inbound_rejected", result: { reason: "toString" } })).toBeNull();
    expect(inboundRejectionCopy({ action: "inbound_rejected", result: null })).toBeNull();
    expect(inboundRejectionCopy({ action: "inbound_message", result: { reason: "no_app_secret" } })).toBeNull();
  });
});
