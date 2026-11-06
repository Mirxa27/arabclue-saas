/**
 * Regression guards for the zod 3.25 -> 4.6 migration. Each case failed (or
 * silently changed behaviour) on an unpatched zod 4 codebase.
 */
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z, ZodError } from "zod";

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    requireUserApi: vi.fn(async () => ({ id: "user-1" })),
    getCurrentMerchant: vi.fn(async () => ({ id: "merchant-1" }))
  };
});

import { handleRouteError, formatZodIssues } from "@/lib/api/route-handler";
import { SallaWebhookEventSchema } from "@/lib/salla/oauth";
import { MoyasarPaymentSchema, MoyasarWebhookEventSchema } from "@/lib/moyasar/types";
import { IsoDateTimeSchema, TaskCreateSchema } from "@/lib/employees/task-schemas";
import { POST as brandKitPost } from "@/app/api/brand-kit/route";

describe("handleRouteError on zod 4", () => {
  it("maps a ZodError to a 400 with field-qualified messages (zod 4 removed .errors)", async () => {
    const parsed = z.object({ a: z.string() }).safeParse({});
    expect(parsed.success).toBe(false);
    const res = handleRouteError((parsed as { error: ZodError }).error);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/^a: /);
  });

  it("bounds the message when a payload produces many issues", () => {
    const parsed = z.array(z.string()).safeParse(Array.from({ length: 50 }, () => 1));
    expect(parsed.success).toBe(false);
    const msg = formatZodIssues((parsed as { error: ZodError }).error);
    expect(msg).toContain("(+45 more)");
    expect(msg.split("; ")).toHaveLength(6);
  });
});

describe("Salla webhook schema", () => {
  it("accepts an event without a data key (zod >= 4.4 rejects absent z.unknown() keys)", () => {
    expect(SallaWebhookEventSchema.parse({ event: "app.uninstalled", merchant: 123 })).toEqual({
      event: "app.uninstalled",
      merchant: 123
    });
  });
});

describe("Moyasar id format", () => {
  const base = { status: "paid", amount: 100, currency: "SAR", created_at: "2026-11-05T12:00:00Z" };
  it("keeps zod 3's permissive 8-4-4-4-12 acceptance for provider ids", () => {
    // Not an RFC 9562 UUID (version nibble 1, variant nibble 1) — z.uuid() in zod 4 rejects it.
    const id = "11111111-1111-1111-1111-111111111111";
    expect(MoyasarPaymentSchema.safeParse({ ...base, id }).success).toBe(true);
    expect(z.uuid().safeParse(id).success).toBe(false);
  });

  it("still rejects non-hex ids (path safety for /payments/:id)", () => {
    expect(MoyasarPaymentSchema.safeParse({ ...base, id: "../../admin" }).success).toBe(false);
    expect(MoyasarWebhookEventSchema.shape.id.safeParse("zzzzzzzz-1111-1111-1111-111111111111").success).toBe(false);
  });
});

describe("task due_at", () => {
  it("accepts minute-precision and full UTC timestamps like zod 3 did", () => {
    expect(IsoDateTimeSchema.safeParse("2026-11-05T12:00Z").success).toBe(true);
    expect(IsoDateTimeSchema.safeParse("2026-11-05T12:00:00Z").success).toBe(true);
    expect(IsoDateTimeSchema.safeParse("2026-11-05T12:00:00.123Z").success).toBe(true);
    expect(TaskCreateSchema.safeParse({ title: "Call back", due_at: null }).success).toBe(true);
  });

  it("rejects non-UTC or malformed values", () => {
    expect(IsoDateTimeSchema.safeParse("2026-11-05 12:00").success).toBe(false);
    expect(IsoDateTimeSchema.safeParse("tomorrow").success).toBe(false);
  });
});

describe("GHSA-mrhx-c7xc-m3w5 — bounded request arrays", () => {
  it("rejects an oversized brand-kit array with a single issue instead of one per element", async () => {
    const req = new NextRequest("http://localhost/api/brand-kit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brand_name: "x", attributes: Array.from({ length: 100_000 }, () => 1) })
    });
    const res = await brandKitPost(req);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/^attributes: /);
    expect(json.error).not.toContain("more)");
  });
});
