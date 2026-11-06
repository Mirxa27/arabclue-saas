/**
 * The merchant's review actions on a post (SW-30, SW-32, SW-47, SW-13):
 * approve drafts, re-queue failed/canceled posts, per-platform captions, honest refusals.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeCall, type FakeSupabase } from "../helpers/fake-supabase";
import { decidePostPatch, PostPatchSchema, type StoredPost } from "@/lib/social/post-edit";
import { applyCaptionEdits } from "@/lib/social/copies";
import type { Merchant } from "@/lib/types/database";

const NOW = new Date("2026-11-06T12:00:00Z");
const FUTURE = "2026-11-10T09:00:00.000Z";
const at = "2026-11-05T09:00:00.000Z";

function stored(overrides: Partial<StoredPost> = {}): StoredPost {
  return {
    id: "post-1",
    status: "draft",
    scheduled_for: FUTURE,
    platforms: ["instagram", "x"],
    copies: {
      instagram: { caption: "IG AI caption: only 99 SAR!", altText: "alt", cta: "shop", hashtags: ["#oud"] },
      x: { caption: "X AI caption: only 99 SAR!", altText: "", cta: "", hashtags: [] }
    },
    media: [{ url: "https://cdn.salla.sa/oud.jpg", productId: "p1" }],
    publish_results: {},
    ...overrides
  };
}

const decide = (post: StoredPost, patch: unknown, entitled = true) =>
  decidePostPatch(post, PostPatchSchema.parse(patch), { now: NOW, entitled });

describe("per-platform captions (SW-30)", () => {
  it("edits each platform's own caption and keeps the other copy fields", () => {
    const { update } = decide(stored(), { captions: { instagram: "IG: 149 SAR", x: "X: 149 SAR" } });
    expect(update.copies).toEqual({
      instagram: { caption: "IG: 149 SAR", altText: "alt", cta: "shop", hashtags: ["#oud"] },
      x: { caption: "X: 149 SAR", altText: "", cta: "", hashtags: [] }
    });
  });

  it("never touches a platform the merchant did not edit, and refuses platforms the post doesn't target", () => {
    const copies = applyCaptionEdits(stored().copies, ["instagram", "x"], { x: "edited" }) as Record<string, { caption: string }>;
    expect(copies.instagram.caption).toBe("IG AI caption: only 99 SAR!");
    expect(() => decide(stored(), { captions: { linkedin: "hi" } })).toThrow(/does not target linkedin/);
  });

  it("refuses to queue an X caption over 280 weighted characters", () => {
    const tooLong = `${"ع".repeat(270)}${"✨".repeat(10)}`;
    expect(() => decide(stored(), { captions: { x: tooLong }, status: "scheduled" })).toThrow(/x: the caption is 290\/280/);
  });
});

describe("approval and re-queue (SW-32, SW-47)", () => {
  it("approves a draft: scheduled, approved_at set", () => {
    const d = decide(stored(), { status: "scheduled" });
    expect(d).toMatchObject({ expectedStatus: "draft", nextStatus: "scheduled" });
    expect(d.update).toMatchObject({ status: "scheduled", approved_at: NOW.toISOString(), error: null, error_code: null });
  });

  it("re-queues a failed post keeping what already went out and retrying the rest", () => {
    const failed = stored({
      status: "failed",
      publish_results: {
        x: { status: "published", remoteId: "tweet-1", at },
        instagram: { status: "failed", code: "rejected", message: "bad image", at }
      }
    });
    const d = decide(failed, { status: "scheduled" });
    expect(d.update.publish_results).toEqual({ x: { status: "published", remoteId: "tweet-1", at } });
    expect(d.update).toMatchObject({ status: "scheduled", error: null, error_code: null });
    expect(d.update).not.toHaveProperty("approved_at");
  });

  it("restores a canceled post, and saving edits alone never changes the status", () => {
    expect(decide(stored({ status: "canceled" }), { status: "scheduled" }).update.status).toBe("scheduled");
    const edit = decide(stored({ status: "failed" }), { hook: "new hook" });
    expect(edit).toMatchObject({ nextStatus: "failed", update: { hook: "new hook" } });
    expect(edit.update).not.toHaveProperty("status");
  });

  it("refuses to queue what cannot publish as written", () => {
    expect(() => decide(stored({ scheduled_for: "2026-11-06T11:00:00.000Z" }), { status: "scheduled" })).toThrow(/at least 2 minutes from now/);
    expect(() => decide(stored({ media: [] }), { status: "scheduled" })).toThrow(/instagram: add an image/);
    // …unless the merchant removes Instagram or attaches an image
    expect(decide(stored({ media: [] }), { status: "scheduled", platforms: ["x"] }).update).toMatchObject({ platforms: ["x"] });
    expect(
      decide(stored({ media: [] }), { status: "scheduled", media: [{ url: "https://cdn.salla.sa/new.jpg" }] }).update.media
    ).toEqual([{ url: "https://cdn.salla.sa/new.jpg" }]);
    expect(() => decide(stored({ platforms: ["tiktok"] }), { status: "scheduled" })).toThrow(/no platform arabclue can publish to/);
  });

  it("requires an active social plan to queue (402) — Lite owners can write rows, not publish them", () => {
    expect(() => decide(stored(), { status: "scheduled" }, false)).toThrow(expect.objectContaining({ status: 402, code: "plan_required" }));
    // cancelling and editing stay possible
    expect(decide(stored(), { status: "canceled" }, false).update.status).toBe("canceled");
  });

  it("locks posts that are publishing or published", () => {
    expect(() => decide(stored({ status: "publishing" }), { hook: "x" })).toThrow(expect.objectContaining({ status: 409, code: "post_publishing" }));
    expect(() => decide(stored({ status: "published" }), { status: "scheduled" })).toThrow(expect.objectContaining({ status: 409, code: "post_published" }));
  });

  it("cannot drop a platform that already published or add one without a caption", () => {
    const partial = stored({ status: "failed", publish_results: { x: { status: "published", remoteId: "t", at } } });
    expect(() => decide(partial, { platforms: ["instagram"] })).toThrow(/already published/);
    expect(() => decide(stored(), { platforms: ["instagram", "x", "linkedin"] })).toThrow(/no caption for it/);
  });

  it("validates the body strictly (no arbitrary copies JSON, https media only)", () => {
    expect(PostPatchSchema.safeParse({ copies: { x: { caption: "hi" } } }).success).toBe(false);
    expect(PostPatchSchema.safeParse({ media: [{ url: "http://cdn.example/a.jpg" }] }).success).toBe(false);
    expect(PostPatchSchema.safeParse({ captions: { myspace: "hi" } }).success).toBe(false);
    expect(PostPatchSchema.safeParse({ status: "published" }).success).toBe(false);
  });
});

// ─── the route: conditional write, 409 on a concurrent claim, agent hint ─────

const h = vi.hoisted(() => ({
  user: null as unknown as FakeSupabase,
  service: null as unknown as FakeSupabase,
  merchant: null as unknown as Merchant
}));
vi.mock("@/lib/db/supabase", () => ({
  getServerSupabase: async () => h.user.client,
  getServiceSupabase: () => h.service.client
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireMerchantApi: vi.fn(async () => h.merchant)
}));
vi.mock("@/lib/observability/error-reporter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/error-reporter")>()),
  reportError: vi.fn()
}));

import { DELETE, PATCH } from "@/app/api/social/post/[id]/route";
import { jsonRequest } from "../helpers/fake-supabase";

describe("PATCH / DELETE /api/social/post/:id", () => {
  let current: StoredPost | null;
  let updated: unknown[];
  let agentRow: { enabled: boolean; status: string } | null;
  beforeEach(() => {
    current = stored();
    updated = [{ id: "post-1", status: "scheduled" }];
    agentRow = { enabled: true, status: "active" };
    h.merchant = { id: "m1", plan: "plus", subscription_status: "active" } as Merchant;
    h.user = createFakeSupabase("user", (call: FakeCall) => {
      if (call.table !== "social_posts") return undefined;
      if (call.op === "select") return { data: current };
      if (call.op === "update" || call.op === "delete") return { data: updated };
      return undefined;
    });
    h.service = createFakeSupabase("service", (call) => {
      if (call.table === "merchants") return { data: { plan: "plus", subscription_status: "active" } };
      if (call.table === "agent_settings" && call.op === "select") return { data: agentRow };
      if (call.table === "agent_settings") return { data: [] };
      return undefined;
    });
  });
  const patch = (body: unknown) =>
    PATCH(jsonRequest("http://localhost/api/social/post/post-1", body, { method: "PATCH" }), { params: Promise.resolve({ id: "post-1" }) });

  it("approves conditionally on the status it read, and reports a paused agent", async () => {
    agentRow = { enabled: false, status: "idle" };
    const res = await patch({ status: "scheduled" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "scheduled", agentActive: false });
    const write = h.user.writes()[0];
    expect(write.filters).toEqual([
      ["eq", "id", "post-1"],
      ["eq", "merchant_id", "m1"],
      ["eq", "status", "draft"]
    ]);
    // insert-only agent row (a paused agent is never switched back on)
    const upsert = h.service.writes().find((c) => c.table === "agent_settings")!;
    expect(upsert.options).toMatchObject({ onConflict: "merchant_id,persona_role", ignoreDuplicates: true });
  });

  it("answers 409 when the cron claimed the post in between", async () => {
    updated = [];
    const res = await patch({ status: "canceled" });
    expect(res.status).toBe(409);
  });

  it("does not delete a post that is being published", async () => {
    updated = [];
    current = stored({ status: "publishing" });
    const res = await DELETE(new Request("http://localhost/api/social/post/post-1", { method: "DELETE" }) as never, {
      params: Promise.resolve({ id: "post-1" })
    });
    expect(res.status).toBe(409);
    expect(h.user.writes()[0].filters).toContainEqual(["neq", "status", "publishing"]);
  });
});
