/**
 * SW-9 / SW-10: the publishing run is idempotent and records one outcome per platform.
 * The store below has the same claim semantics as claim_due_social_posts + the claim-conditional
 * writes (a claim is atomic; writes only apply while the run still holds the claim). The SQL
 * itself is proven in supabase/tests/65_social_claims.test.sql and against the real stack in
 * __tests__/integration/social-publishing.int.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { runSocialScheduler } from "@/lib/social/scheduler";
import type { ClaimedPost, SocialPublishStore } from "@/lib/social/publish-store";
import type { MerchantPublishers, PlatformPublisher } from "@/lib/social/publishers";
import { PublishError } from "@/lib/social/publish-error";
import type { PostOutcome, PublishResults } from "@/lib/social/outcomes";
import type { Platform, PublishPayload } from "@/lib/social/types";

type Row = {
  id: string;
  merchantId: string;
  status: string;
  claimId: string | null;
  claimedAt: number | null;
  attempts: number;
  scheduledFor: number;
  platforms: Platform[];
  copies: ClaimedPost["copies"];
  media: ClaimedPost["media"];
  results: PublishResults;
  remoteIds: Record<string, string>;
  error: string | null;
  errorCode: string | null;
  publishedAt: string | null;
};

const T0 = Date.parse("2026-11-06T12:00:00Z");
const clone = <T>(v: T): T => structuredClone(v);

function memoryStore(rows: Row[], clock: () => number, faults: { saveErrors?: (call: number) => boolean } = {}) {
  let saves = 0;
  const toClaimed = (r: Row): ClaimedPost => ({
    id: r.id,
    merchantId: r.merchantId,
    claimId: r.claimId!,
    attempts: r.attempts,
    scheduledFor: new Date(r.scheduledFor).toISOString(),
    platforms: [...r.platforms],
    copies: clone(r.copies),
    media: clone(r.media),
    results: clone(r.results),
    remoteIds: clone(r.remoteIds)
  });
  const held = (post: ClaimedPost) => {
    const row = rows.find((r) => r.id === post.id);
    return row && row.status === "publishing" && row.claimId === post.claimId ? row : null;
  };
  const store: SocialPublishStore = {
    async holdUnpublishable() {
      return [];
    },
    async claimDue(limit) {
      // Atomic, like FOR UPDATE SKIP LOCKED + UPDATE … RETURNING: no await inside.
      const claimId = randomUUID();
      return rows
        .filter((r) => r.status === "scheduled" && r.scheduledFor <= clock())
        .sort((a, b) => a.scheduledFor - b.scheduledFor)
        .slice(0, limit)
        .map((r) => {
          Object.assign(r, { status: "publishing", claimId, claimedAt: clock(), attempts: r.attempts + 1 });
          return toClaimed(r);
        });
    },
    async saveProgress(post) {
      saves += 1;
      if (faults.saveErrors?.(saves)) throw new Error("statement timeout");
      const row = held(post);
      if (!row) return false;
      row.results = clone(post.results);
      row.remoteIds = clone(post.remoteIds);
      return true;
    },
    async finalize(post, outcome: PostOutcome) {
      const row = held(post);
      if (!row) return false;
      Object.assign(row, {
        status: outcome.status,
        publishedAt: outcome.publishedAt,
        error: outcome.error,
        errorCode: outcome.errorCode,
        results: clone(post.results),
        remoteIds: clone(post.remoteIds),
        claimId: null,
        claimedAt: null
      });
      return true;
    },
    async release(post, opts) {
      const row = held(post);
      if (!row) return false;
      Object.assign(row, {
        status: "scheduled",
        claimId: null,
        claimedAt: null,
        attempts: opts.countAttempt ? post.attempts : Math.max(0, post.attempts - 1),
        results: clone(post.results),
        remoteIds: clone(post.remoteIds)
      });
      return true;
    },
    async listStale(beforeISO, limit) {
      const before = Date.parse(beforeISO);
      return rows
        .filter((r) => r.status === "publishing" && r.claimedAt !== null && r.claimedAt < before)
        .slice(0, limit)
        .map(toClaimed);
    },
    async loadChannels() {
      return [];
    }
  };
  return store;
}

function row(id: string, platforms: Platform[], overrides: Partial<Row> = {}): Row {
  return {
    id,
    merchantId: "m1",
    status: "scheduled",
    claimId: null,
    claimedAt: null,
    attempts: 0,
    scheduledFor: T0 - 60_000,
    platforms,
    copies: Object.fromEntries(platforms.map((p) => [p, { caption: `${p} caption for ${id}`, altText: "", cta: "", hashtags: [] }])),
    media: [{ url: "https://cdn.salla.sa/p/1.jpg", productId: "p1" }],
    results: {},
    remoteIds: {},
    error: null,
    errorCode: null,
    publishedAt: null,
    ...overrides
  };
}

type PublishFn = (payload: PublishPayload) => Promise<{ remoteId: string }>;

function publishers(map: Partial<Record<Platform, PublishFn | { code: "not_connected" | "unsupported"; message: string }>>): MerchantPublishers {
  const out = new Map<Platform, PlatformPublisher>();
  for (const [platform, v] of Object.entries(map) as Array<[Platform, PublishFn | { code: "not_connected" | "unsupported"; message: string }]>) {
    out.set(platform, typeof v === "function" ? { platform, available: true, publish: v } : { platform, available: false, ...v });
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("runSocialScheduler — exactly once (SW-9)", () => {
  it("two overlapping runs publish every post once per platform", async () => {
    const rows = ["p1", "p2", "p3", "p4"].map((id) => row(id, ["x", "linkedin"]));
    const store = memoryStore(rows, () => T0);
    const calls: string[] = [];
    const slow = (platform: string): PublishFn => async (payload) => {
      calls.push(`${platform}:${payload.copy.caption}`);
      await sleep(5);
      return { remoteId: `${platform}-${calls.length}` };
    };
    const deps = {
      store,
      publishersFor: async () => publishers({ x: slow("x"), linkedin: slow("linkedin") }),
      now: () => T0,
      limits: { batchSize: 2 }
    };

    const [a, b] = await Promise.all([runSocialScheduler(deps), runSocialScheduler(deps)]);

    expect(calls).toHaveLength(8); // 4 posts × 2 platforms, never more
    expect(new Set(calls).size).toBe(8);
    expect(a.claimed + b.claimed).toBe(4);
    expect(rows.every((r) => r.status === "published" && Object.keys(r.remoteIds).length === 2)).toBe(true);
  });

  it("a run that loses its claim never publishes the post", async () => {
    const rows = [row("p1", ["x"])];
    const store = memoryStore(rows, () => T0);
    const publish = vi.fn<PublishFn>(async () => ({ remoteId: "t1" }));
    // The owner (or another run's recovery) changes the row right after the claim.
    const claimDue = store.claimDue.bind(store);
    store.claimDue = async (limit) => {
      const claimed = await claimDue(limit);
      rows[0].claimId = randomUUID();
      return claimed;
    };
    const summary = await runSocialScheduler({ store, publishersFor: async () => publishers({ x: publish }), now: () => T0 });
    expect(publish).not.toHaveBeenCalled();
    expect(summary.abandoned).toBe(1);
  });

  it("a status write that fails after a publish never turns into a second publish", async () => {
    let t = T0;
    const rows = [row("p1", ["x"])];
    // save #1 = 'sending' marker (ok); saves #2-#4 = the outcome write, all failing
    const store = memoryStore(rows, () => t, { saveErrors: (n) => n >= 2 && n <= 4 });
    const publish = vi.fn<PublishFn>(async () => ({ remoteId: "tweet-1" }));
    const deps = { store, publishersFor: async () => publishers({ x: publish }), now: () => t, sleep: async () => undefined };

    const first = await runSocialScheduler(deps);
    expect(first.abandoned).toBe(1);
    expect(rows[0].status).toBe("publishing");
    expect(rows[0].results.x?.status).toBe("sending");

    // The next run (after the stale window) closes it honestly instead of re-posting.
    t = T0 + 8 * 60_000;
    const second = await runSocialScheduler(deps);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(second.recovered).toBe(1);
    expect(rows[0]).toMatchObject({ status: "failed", errorCode: "outcome_unknown" });
    expect(rows[0].results.x).toMatchObject({ status: "unknown", code: "outcome_unknown" });
  });

  it("a stale claim with nothing in flight goes back to the queue and publishes on the next run", async () => {
    let t = T0;
    const rows = [row("p1", ["x"], { status: "publishing", claimId: randomUUID(), claimedAt: T0 - 10 * 60_000, attempts: 1 })];
    const store = memoryStore(rows, () => t);
    const publish = vi.fn<PublishFn>(async () => ({ remoteId: "tweet-9" }));
    const summary = await runSocialScheduler({ store, publishersFor: async () => publishers({ x: publish }), now: () => t });
    expect(summary.recovered).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1); // released, then claimed again in the same run
    expect(rows[0]).toMatchObject({ status: "published", remoteIds: { x: "tweet-9" } });
  });

  it("closes a post that keeps crashing runs after 3 attempts", async () => {
    const rows = [row("p1", ["x"], { status: "publishing", claimId: randomUUID(), claimedAt: T0 - 10 * 60_000, attempts: 3 })];
    const store = memoryStore(rows, () => T0);
    const publish = vi.fn<PublishFn>(async () => ({ remoteId: "t" }));
    await runSocialScheduler({ store, publishersFor: async () => publishers({ x: publish }), now: () => T0 });
    expect(publish).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ status: "failed", errorCode: "too_many_attempts" });
  });

  it("never re-sends a platform left 'unknown' or 'sending' by an earlier run", async () => {
    const at = new Date(T0 - 3600_000).toISOString();
    const rows = [
      row("p1", ["x", "linkedin"], { results: { x: { status: "unknown", code: "outcome_unknown", at } } }),
      row("p2", ["x", "linkedin"], { results: { x: { status: "sending", at } } })
    ];
    const store = memoryStore(rows, () => T0);
    const x = vi.fn<PublishFn>(async () => ({ remoteId: "tw" }));
    const linkedin = vi.fn<PublishFn>(async () => ({ remoteId: "urn:li:share:1" }));
    await runSocialScheduler({ store, publishersFor: async () => publishers({ x, linkedin }), now: () => T0 });
    expect(x).not.toHaveBeenCalled();
    expect(linkedin).toHaveBeenCalledTimes(2);
    for (const r of rows) {
      expect(r.results.x?.status).toBe("unknown");
      expect(r).toMatchObject({ status: "published", errorCode: "partial" });
    }
  });

  it("stops claiming at the time budget and releases what it did not start", async () => {
    let t = T0;
    const rows = ["p1", "p2", "p3"].map((id) => row(id, ["x"]));
    const store = memoryStore(rows, () => t);
    let n = 0;
    const publish = vi.fn<PublishFn>(async () => {
      t += 150_000;
      n += 1;
      return { remoteId: `t${n}` };
    });
    const summary = await runSocialScheduler({
      store,
      publishersFor: async () => publishers({ x: publish }),
      now: () => t,
      limits: { batchSize: 3, runBudgetMs: 240_000 }
    });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(summary.stoppedEarly).toBe(true);
    expect(rows.map((r) => r.status)).toEqual(["published", "published", "scheduled"]);
    expect(rows[2].attempts).toBe(0); // a release for time is not an attempt
  });
});

describe("runSocialScheduler — per-platform outcomes (SW-10)", () => {
  it("one platform's failure neither stops the others nor marks a live post failed", async () => {
    const rows = [row("p1", ["x", "linkedin", "instagram"], { media: [] })];
    const store = memoryStore(rows, () => T0);
    const x = vi.fn<PublishFn>(async () => ({ remoteId: "tweet-1" }));
    const linkedin = vi.fn<PublishFn>(async () => {
      throw new PublishError("rejected", "LinkedIn API 422: invalid commentary", { status: 422 });
    });
    const instagram = vi.fn<PublishFn>(async () => ({ remoteId: "ig" }));
    await runSocialScheduler({ store, publishersFor: async () => publishers({ x, linkedin, instagram }), now: () => T0 });

    expect(x).toHaveBeenCalledTimes(1);
    expect(linkedin).toHaveBeenCalledTimes(1);
    expect(instagram).not.toHaveBeenCalled(); // no image: skipped before any request
    expect(rows[0]).toMatchObject({ status: "published", errorCode: "partial", remoteIds: { x: "tweet-1" } });
    expect(rows[0].results).toMatchObject({
      x: { status: "published", remoteId: "tweet-1" },
      linkedin: { status: "failed", code: "rejected", message: "LinkedIn API 422: invalid commentary" },
      instagram: { status: "skipped", code: "no_image" }
    });
    expect(rows[0].error).toMatch(/^Partially published — linkedin: failed/);
  });

  it("a failing first platform does not stop the later ones", async () => {
    const rows = [row("p1", ["instagram", "x"])];
    const store = memoryStore(rows, () => T0);
    const instagram = vi.fn<PublishFn>(async () => {
      throw new PublishError("rejected", "Instagram API 400: Only photo or video can be accepted as media type.", { status: 400 });
    });
    const x = vi.fn<PublishFn>(async () => ({ remoteId: "tweet-2" }));
    await runSocialScheduler({ store, publishersFor: async () => publishers({ instagram, x }), now: () => T0 });
    expect(x).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ status: "published", remoteIds: { x: "tweet-2" } });
  });

  it("a re-queued post only retries the platforms that are not live yet", async () => {
    const at = new Date(T0 - 86_400_000).toISOString();
    const rows = [
      row("p1", ["x", "linkedin"], {
        results: { x: { status: "published", remoteId: "tweet-old", at } },
        remoteIds: { x: "tweet-old" }
      })
    ];
    const store = memoryStore(rows, () => T0);
    const x = vi.fn<PublishFn>(async () => ({ remoteId: "tweet-dup" }));
    const linkedin = vi.fn<PublishFn>(async () => ({ remoteId: "urn:li:share:2" }));
    await runSocialScheduler({ store, publishersFor: async () => publishers({ x, linkedin }), now: () => T0 });
    expect(x).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ status: "published", errorCode: null, remoteIds: { x: "tweet-old", linkedin: "urn:li:share:2" } });
    expect(rows[0].publishedAt).toBe(at); // first time it went live
  });

  it("marks a post failed (never published) when nothing could be sent, with every reason", async () => {
    const rows = [row("p1", ["instagram", "x", "tiktok"])];
    const store = memoryStore(rows, () => T0);
    await runSocialScheduler({
      store,
      publishersFor: async () =>
        publishers({
          instagram: { code: "not_connected", message: "instagram: account not connected" },
          tiktok: { code: "unsupported", message: "TikTok publishing isn't available" }
        }),
      now: () => T0
    });
    expect(rows[0]).toMatchObject({ status: "failed", errorCode: "not_published" });
    expect(rows[0].results).toMatchObject({
      instagram: { status: "skipped", code: "not_connected" },
      x: { status: "skipped", code: "not_connected" },
      tiktok: { status: "skipped", code: "unsupported" }
    });
  });

  it("publishes each platform's own caption and the catalog images", async () => {
    const rows = [row("p1", ["x", "instagram"])];
    const store = memoryStore(rows, () => T0);
    const seen: PublishPayload[] = [];
    const record: PublishFn = async (payload) => {
      seen.push(payload);
      return { remoteId: String(seen.length) };
    };
    await runSocialScheduler({ store, publishersFor: async () => publishers({ x: record, instagram: record }), now: () => T0 });
    expect(seen.map((p) => p.copy.caption)).toEqual(["x caption for p1", "instagram caption for p1"]);
    expect(seen[1].images).toEqual([{ url: "https://cdn.salla.sa/p/1.jpg", productId: "p1" }]);
  });
});
