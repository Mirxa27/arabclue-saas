/**
 * Shared webhook plumbing: bounded records (critic-5), Twilio public-URL candidates,
 * claim batching / dedupe, and the after() worker's ordering + complete/release.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createClaimDb, type ClaimDb } from "../helpers/webhook-fakes";

const h = vi.hoisted(() => ({ db: null as unknown as ClaimDb }));
vi.mock("@/lib/db/supabase", () => ({ getServiceSupabase: () => h.db.client }));
vi.mock("@/lib/observability/error-reporter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/observability/error-reporter")>();
  return { ...actual, reportError: vi.fn() };
});

import { boundedRecord, hasAtMostKeys } from "@/lib/api/zod-bounds";
import { publicUrlCandidates } from "@/lib/http/public-url";
import { claimInboundEvents, inboundAckStatus, processClaimedInbound } from "@/lib/webhooks/inbound-claims";

beforeEach(() => {
  h.db = createClaimDb();
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.APP_BASE_URL;
});

describe("boundedRecord", () => {
  const schema = boundedRecord(3, z.string().max(5), z.number());

  it("accepts up to the cap and rejects beyond it before parsing entries", () => {
    expect(schema.parse({ a: 1, b: 2, c: 3 })).toEqual({ a: 1, b: 2, c: 3 });
    const tooMany = schema.safeParse({ a: 1, b: 2, c: 3, d: 4 });
    expect(tooMany.success).toBe(false);
    expect(tooMany.error?.issues).toHaveLength(1); // only the size issue: no entry was parsed
    expect(schema.safeParse({ a: "x" }).success).toBe(false);
  });

  it("counts with an early exit", () => {
    const huge = Object.fromEntries(Array.from({ length: 200_000 }, (_, i) => [`k${i}`, i]));
    const t0 = Date.now();
    expect(hasAtMostKeys(huge, 30)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(200);
    expect(hasAtMostKeys("not an object", 1)).toBe(true);
  });
});

describe("publicUrlCandidates (Twilio signs the exact public URL)", () => {
  it("includes the configured site URL and the forwarded host, keeping the query string", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://arabclue.com/";
    const req = new Request("http://10.0.0.7:3000/api/voice/twilio/inbound?x=1", {
      headers: { "x-forwarded-host": "www.arabclue.com", "x-forwarded-proto": "https" }
    });
    expect(publicUrlCandidates(req)).toEqual([
      "https://arabclue.com/api/voice/twilio/inbound?x=1",
      "https://www.arabclue.com/api/voice/twilio/inbound?x=1",
      "http://10.0.0.7:3000/api/voice/twilio/inbound?x=1"
    ]);
  });

  it("ignores malformed bases and hosts", () => {
    process.env.APP_BASE_URL = "javascript:alert(1)";
    const req = new Request("https://a.test/p", { headers: { "x-forwarded-host": "evil.test/../x" } });
    expect(publicUrlCandidates(req)).toEqual(["https://a.test/p"]);
  });
});

describe("claimInboundEvents", () => {
  it("dedupes ids within a batch and counts duplicates / in-flight claims", async () => {
    h.db.claims.set("p:done", "done");
    h.db.claims.set("p:busy", "processing");
    const s = await claimInboundEvents("p", [
      { eventId: "a", item: 1 },
      { eventId: "a", item: 2 },
      { eventId: "done", item: 3 },
      { eventId: "busy", item: 4 },
      { eventId: "b", item: 5 }
    ]);
    expect(s.claimed.map((c) => c.item)).toEqual([1, 5]);
    expect(s).toMatchObject({ duplicates: 1, inProgress: 1, failure: null });
    expect(inboundAckStatus(s)).toBe(409);
  });

  it("stops starting new claims after one fails", async () => {
    h.db = createClaimDb(undefined, { failClaimsAfter: 2 });
    const many = Array.from({ length: 20 }, (_, i) => ({ eventId: `e${i}`, item: i }));
    const s = await claimInboundEvents("p", many, 4);
    expect(s.failure).toBeTruthy();
    expect(s.claimed.map((c) => c.item)).toEqual([0, 1]);
    expect(h.db.claimCalls()).toBe(4); // the first batch only
    expect(inboundAckStatus(s)).toBe(500);
  });
});

describe("processClaimedInbound", () => {
  it("keeps per-key order, runs keys concurrently, completes successes and releases failures", async () => {
    const claimed = [
      { eventId: "a1", item: { key: "A", n: 1 } },
      { eventId: "b1", item: { key: "B", n: 1 } },
      { eventId: "a2", item: { key: "A", n: 2 } },
      { eventId: "b2", item: { key: "B", n: 2 } }
    ];
    for (const c of claimed) h.db.claims.set(`p:${c.eventId}`, "processing");
    const order: string[] = [];
    const failures: string[] = [];
    await processClaimedInbound({
      provider: "p",
      route: "test",
      claimed,
      orderKey: (i) => i.key,
      concurrency: 2,
      handle: async (i) => {
        await new Promise((r) => setTimeout(r, i.key === "A" ? 5 : 1));
        if (i.key === "B" && i.n === 2) throw new Error("boom");
        order.push(`${i.key}${i.n}`);
      },
      onFailure: async (i) => {
        failures.push(`${i.key}${i.n}`);
      }
    });
    expect(order.filter((x) => x.startsWith("A"))).toEqual(["A1", "A2"]);
    expect(order.indexOf("B1")).toBeLessThan(order.indexOf("A1")); // B did not wait for A
    expect(failures).toEqual(["B2"]);
    expect(h.db.claims.get("p:a2")).toBe("done");
    expect(h.db.claims.get("p:b2")).toBe("failed");
  });
});
