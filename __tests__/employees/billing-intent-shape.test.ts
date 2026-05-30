import { describe, expect, it } from "vitest";
import { z } from "zod";

/** Documents the employee billing intent API contract (see POST /api/employees/billing/intent). */
const IntentResponseSchema = z.object({
  intentId: z.string().uuid(),
  employeeId: z.string().uuid(),
  amount: z.number().int().positive(),
  currency: z.literal("SAR"),
  description: z.string().nullable(),
  publishableKey: z.string(),
  callbackUrl: z.string().url(),
  metadata: z.record(z.string())
});

describe("employee billing intent response shape", () => {
  it("matches documented fields", () => {
    const sample = {
      intentId: "00000000-0000-4000-8000-000000000001",
      employeeId: "00000000-0000-4000-8000-000000000002",
      amount: 9900,
      currency: "SAR" as const,
      description: "AI employee — Layla (monthly)",
      publishableKey: "pk_test_xxx",
      callbackUrl: "https://arabclue.com/employees/x?billing=complete&intent=y",
      metadata: { type: "employee", employee_id: "00000000-0000-4000-8000-000000000002" }
    };
    expect(IntentResponseSchema.parse(sample).amount).toBe(9900);
  });
});
