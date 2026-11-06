/**
 * RA-10: the per-user limits on paid / mail-sending routes were keyed `${scope}:${ip}:${userId}`,
 * so one account that rotated source IPs (a proxy pool, IPv6 /64s) got a fresh budget per
 * address. They are keyed on the signed-in user (`{ identity: user.id }`) instead.
 */
import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { jsonRequest } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({ user: null as { id: string; email?: string | null } | null }));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    requireUserApi: vi.fn(async () => {
      if (!h.user) throw new actual.AuthError();
      return h.user;
    }),
    getCurrentMerchant: vi.fn(async () => null)
  };
});
vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => ({}),
  getServerSupabase: async () => ({})
}));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/agents/brand-kit-generator", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agents/brand-kit-generator")>()),
  generateBrandKitSuggestion: vi.fn(async () => ({ essence: "متجر", attributes: [], favor_words: [], avoid_words: [], dialect: "msa" }))
}));
vi.mock("@/lib/support/tickets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/support/tickets")>()),
  createSupportTicket: vi.fn(async () => ({ id: "t-1", created_at: "2026-11-06T10:00:00Z", contact_email: null })),
  markTicketForwarded: vi.fn(async () => undefined),
  recordFeedback: vi.fn(async () => undefined)
}));
vi.mock("@/lib/support/notify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/support/notify")>()),
  isSupportEmailConfigured: () => false,
  sendSupportAck: vi.fn(),
  forwardSupportTicket: vi.fn(async () => ({ status: "skipped" }))
}));
vi.mock("@/lib/merchant/onboarding", () => ({
  completeOnboarding: vi.fn(async () => ({ merchantId: "m-1", created: true }))
}));

import { POST as brandKitGenerate } from "@/app/api/brand-kit/generate/route";
import { POST as supportPost } from "@/app/api/support/route";
import { POST as feedbackPost } from "@/app/api/feedback/route";
import { POST as onboardingPost } from "@/app/api/merchant/onboarding/route";

type Handler = (req: NextRequest) => Promise<Response>;

const ROUTES: Array<[string, Handler, string, unknown, number]> = [
  ["POST /api/brand-kit/generate", brandKitGenerate, "/api/brand-kit/generate", { brand_name: "Store" }, 5],
  ["POST /api/support", supportPost, "/api/support", { category: "help", message: "hello there" }, 5],
  ["POST /api/feedback", feedbackPost, "/api/feedback", { sentiment: "up" }, 20],
  ["POST /api/merchant/onboarding", onboardingPost, "/api/merchant/onboarding", { businessName: "Store", dpaAccepted: true }, 10]
];

let seq = 0;
function freshUser() {
  seq += 1;
  h.user = { id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, email: "owner@store.sa" };
}

const send = (handler: Handler, path: string, body: unknown, ip: string) =>
  handler(jsonRequest(`http://localhost${path}`, body, { headers: { "x-forwarded-for": ip } }));

describe("per-user rate limits follow the account, not the address", () => {
  it.each(ROUTES)("%s: rotating IPv4 addresses does not reset the budget", async (_route, handler, path, body, limit) => {
    freshUser();
    for (let i = 0; i < limit; i++) {
      expect((await send(handler, path, body, `203.0.113.${i + 1}`)).status).not.toBe(429);
    }
    const rotated = await send(handler, path, body, "198.51.100.200");
    expect(rotated.status).toBe(429);
    expect(((await rotated.json()) as { code: string }).code).toBe("rate_limited");
  });

  it.each(ROUTES)("%s: rotating IPv6 /64s does not reset the budget either", async (_route, handler, path, body, limit) => {
    freshUser();
    for (let i = 0; i < limit; i++) {
      expect((await send(handler, path, body, `2001:db8:${(i + 1).toString(16)}::1`)).status).not.toBe(429);
    }
    expect((await send(handler, path, body, "2001:db8:ffff::1")).status).toBe(429);
  });

  it.each(ROUTES)("%s: another account on the same IP has its own budget", async (_route, handler, path, body, limit) => {
    freshUser();
    for (let i = 0; i < limit; i++) await send(handler, path, body, "203.0.113.250");
    expect((await send(handler, path, body, "203.0.113.250")).status).toBe(429);
    freshUser();
    expect((await send(handler, path, body, "203.0.113.250")).status).not.toBe(429);
  });
});
