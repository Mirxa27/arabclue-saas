import { describe, expect, it, vi } from "vitest";
import { scheduler, type ScheduledPost, type SocialStore } from "@/lib/social/agent";
import type { PlatformConnector } from "@/lib/social/types";

function post(platforms: string[]): ScheduledPost {
  return {
    id: "p1",
    merchantId: "m1",
    post: { platforms } as unknown as ScheduledPost["post"],
    copies: Object.fromEntries(platforms.map((p) => [p, { caption: `copy for ${p}` }])) as ScheduledPost["copies"],
    status: "scheduled"
  };
}

function store(due: ScheduledPost[]) {
  return {
    upsertPost: vi.fn(),
    listDue: vi.fn(async () => due),
    markPublished: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined)
  } satisfies SocialStore;
}

const connector = (platform: string): PlatformConnector =>
  ({ platform, publish: vi.fn(async () => ({ remoteId: `${platform}-remote` })) }) as unknown as PlatformConnector;

describe("scheduler outcomes", () => {
  it("marks a post FAILED (not published) when none of its platforms is connected", async () => {
    const s = store([post(["instagram", "x"])]);
    const results = await scheduler({ store: s, connectorsForMerchant: () => [] });
    expect(s.markPublished).not.toHaveBeenCalled();
    expect(s.markFailed).toHaveBeenCalledWith("p1", expect.stringMatching(/Not published — instagram: account not connected; x: account not connected/));
    expect(results[0].ok).toBe(false);
  });

  it("publishes what it can and records the skipped platforms", async () => {
    const s = store([post(["instagram", "x"])]);
    await scheduler({ store: s, connectorsForMerchant: () => [connector("instagram")] });
    expect(s.markPublished).toHaveBeenCalledWith(
      "p1",
      expect.any(String),
      { instagram: "instagram-remote" },
      expect.stringContaining("x: account not connected")
    );
  });

  it("marks a fully published post without a note", async () => {
    const s = store([post(["instagram"])]);
    await scheduler({ store: s, connectorsForMerchant: () => [connector("instagram")] });
    expect(s.markPublished).toHaveBeenCalledWith("p1", expect.any(String), { instagram: "instagram-remote" }, undefined);
  });
});
