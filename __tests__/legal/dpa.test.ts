import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const update = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/supabase", () => ({
  getServerSupabase: async () => ({ from: () => ({ update: (row: unknown) => ({ eq: async () => update(row) }) }) })
}));
vi.mock("@/lib/auth/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/session")>()),
  requireMerchantApi: vi.fn(async () => ({ id: "m1", dpa_version: "2025-01" }))
}));

import { POST } from "@/app/api/merchant/dpa/route";
import { CURRENT_DPA_VERSION, merchantNeedsDpaAcceptance } from "@/lib/legal/dpa";

const post = (body: unknown, origin = "http://localhost") =>
  POST(
    new NextRequest("http://localhost/api/merchant/dpa", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body)
    })
  );

beforeEach(() => update.mockReset().mockResolvedValue({ error: null }));

describe("DPA re-acceptance", () => {
  it("flags merchants on an older (or no) DPA version", () => {
    expect(merchantNeedsDpaAcceptance({ dpa_version: "2025-01" })).toBe(true);
    expect(merchantNeedsDpaAcceptance({ dpa_version: null })).toBe(true);
    expect(merchantNeedsDpaAcceptance({ dpa_version: CURRENT_DPA_VERSION })).toBe(false);
    expect(merchantNeedsDpaAcceptance(null)).toBe(false);
  });

  it("records acceptance of the current version", async () => {
    const res = await post({ accept: true, version: CURRENT_DPA_VERSION });
    expect(res.status).toBe(200);
    const row = update.mock.calls[0][0] as { dpa_version: string; dpa_accepted_at: string };
    expect(row.dpa_version).toBe(CURRENT_DPA_VERSION);
    expect(Number.isNaN(Date.parse(row.dpa_accepted_at))).toBe(false);
  });

  it("rejects acceptance of a stale version, extra keys and cross-site requests", async () => {
    expect((await post({ accept: true, version: "2025-01" })).status).toBe(400);
    expect((await post({ accept: true, version: CURRENT_DPA_VERSION, plan: "pro" })).status).toBe(400);
    expect((await post({ accept: true, version: CURRENT_DPA_VERSION }, "https://evil.example")).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });
});
