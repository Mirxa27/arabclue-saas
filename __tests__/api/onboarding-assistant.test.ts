import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const aiText = vi.hoisted(() => vi.fn(async () => "مرحبا! Hello."));
vi.mock("@/lib/ai/providers", () => ({ aiText }));
vi.mock("@/lib/auth/session", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/session")>()),
  requireUserApi: vi.fn(async () => ({ id: `user-${Math.random()}` }))
}));

import { POST } from "@/app/api/assistant/onboarding/route";
import { requireUserApi } from "@/lib/auth/session";

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/assistant/onboarding", { method: "POST", body: JSON.stringify(body) }));
const valid = { step: 1, context: {}, messages: [{ role: "user", content: "hi" }] };

beforeEach(() => aiText.mockClear());

describe("POST /api/assistant/onboarding (F19)", () => {
  it("answers a valid request", async () => {
    const res = await post(valid);
    expect(res.status).toBe(200);
    expect(aiText).toHaveBeenCalledTimes(1);
  });

  it("rate-limits each user to 20 LLM calls per minute", async () => {
    vi.mocked(requireUserApi).mockResolvedValue({ id: "same-user" } as Awaited<ReturnType<typeof requireUserApi>>);
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await post(valid)).status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
    expect(aiText).toHaveBeenCalledTimes(20);
  });

  it("rejects oversized context before calling the model", async () => {
    vi.mocked(requireUserApi).mockResolvedValue({ id: "other-user" } as Awaited<ReturnType<typeof requireUserApi>>);
    const res = await post({ ...valid, context: { essence: "x".repeat(2001) } });
    expect(res.status).toBe(400);
    expect(aiText).not.toHaveBeenCalled();
  });
});
