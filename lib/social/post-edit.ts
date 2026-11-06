/**
 * PATCH /api/social/post/:id — the merchant's review actions (SW-30, SW-32, SW-47, SW-13).
 *
 *   approve      draft            → scheduled   (the only way a generated post can publish)
 *   re-queue     failed/canceled  → scheduled   (platforms already published stay done;
 *                                                failed / skipped / unknown ones are retried)
 *   cancel       draft/scheduled/failed → canceled
 *   edit         hook, time, per-platform captions, platforms (subset), media — while the post is
 *                draft / scheduled / failed / canceled; never while publishing or once published
 *
 * Anything that ends 'scheduled' must be publishable as written: an active plan, a future time,
 * every publishable platform with a caption inside its limit (X weighted 280), and an image for
 * Instagram. The write is conditional on the status the decision was made on, so a cron claim
 * in between turns into a 409 instead of a lost edit.
 */
import { z } from "zod";
import { HttpError } from "@/lib/api/errors";
import { CAPTION_LIMITS, applyCaptionEdits, captionFor, captionLength } from "./copies";
import { PostMediaListSchema, parsePostMedia } from "./media";
import { parsePublishResults, type PublishResults } from "./outcomes";
import { SOCIAL_PLATFORMS, isPlatform, isPublishablePlatform, type Platform } from "./types";

/** Earliest a post may be (re)scheduled. */
export const SCHEDULE_LEAD_MS = 2 * 60_000;

export const PostPatchSchema = z
  .object({
    scheduledFor: z.iso.datetime({ offset: true }).optional(),
    status: z.enum(["scheduled", "canceled"]).optional(),
    hook: z.string().trim().max(500).optional(),
    captions: z.partialRecord(z.enum(SOCIAL_PLATFORMS), z.string().max(4000)).optional(),
    platforms: z.array(z.enum(SOCIAL_PLATFORMS)).min(1).max(6).optional(),
    media: PostMediaListSchema.optional()
  })
  .strict();
export type PostPatch = z.infer<typeof PostPatchSchema>;

export type StoredPost = {
  id: string;
  status: string;
  scheduled_for: string;
  platforms: string[] | null;
  copies: unknown;
  media: unknown;
  publish_results: unknown;
};

export type PatchDecision = {
  /** Column values to write. */
  update: Record<string, unknown>;
  /** The status the decision was made on (the update is conditional on it). */
  expectedStatus: string;
  nextStatus: string;
};

const EDITABLE = new Set(["draft", "scheduled", "failed", "canceled"]);

export type SchedulingProblem = { platform?: Platform; code: string; message: string };

/** Why a post could not publish as written (empty = it can). */
export function schedulingProblems(post: {
  scheduledFor: string;
  platforms: readonly Platform[];
  copies: unknown;
  media: unknown;
  now: Date;
}): SchedulingProblem[] {
  const problems: SchedulingProblem[] = [];
  const at = Date.parse(post.scheduledFor);
  if (!Number.isFinite(at) || at < post.now.getTime() + SCHEDULE_LEAD_MS) {
    problems.push({ code: "schedule_in_past", message: "Pick a time at least 2 minutes from now" });
  }
  const publishable = post.platforms.filter(isPublishablePlatform);
  if (publishable.length === 0) {
    problems.push({ code: "no_publishable_platform", message: "This post has no platform arabclue can publish to (Instagram, X or LinkedIn)" });
  }
  for (const platform of publishable) {
    const caption = captionFor(post.copies, platform).trim();
    if (!caption) {
      problems.push({ platform, code: "no_copy", message: `${platform}: the caption is empty` });
      continue;
    }
    const limit = CAPTION_LIMITS[platform];
    const length = captionLength(platform, caption);
    if (limit !== undefined && length > limit) {
      problems.push({ platform, code: "caption_too_long", message: `${platform}: the caption is ${length}/${limit} characters` });
    }
    if (platform === "instagram" && parsePostMedia(post.media).length === 0) {
      problems.push({
        platform,
        code: "no_image",
        message: "instagram: add an image (JPEG from your catalog) or remove Instagram from this post"
      });
    }
  }
  return problems;
}

/** Keep only what already went out; everything else is retried on the next run. */
export function resetForRequeue(results: unknown): PublishResults {
  const parsed = parsePublishResults(results);
  const kept: PublishResults = {};
  for (const [platform, result] of Object.entries(parsed) as Array<[Platform, NonNullable<PublishResults[Platform]>]>) {
    if (result.status === "published") kept[platform] = result;
  }
  return kept;
}

/** Decide the write for a PATCH (throws HttpError for refused transitions / invalid posts). */
export function decidePostPatch(current: StoredPost, patch: PostPatch, ctx: { now: Date; entitled: boolean }): PatchDecision {
  if (current.status === "publishing") throw new HttpError(409, "This post is being published right now", "post_publishing");
  if (current.status === "published") throw new HttpError(409, "Published posts can't be changed", "post_published");
  if (!EDITABLE.has(current.status)) throw new HttpError(409, `A ${current.status} post can't be changed`, "post_locked");

  const currentPlatforms = (current.platforms ?? []).filter(isPlatform);
  const results = parsePublishResults(current.publish_results);
  const update: Record<string, unknown> = {};

  let platforms = currentPlatforms;
  if (patch.platforms) {
    const next = [...new Set(patch.platforms)];
    const added = next.filter((p) => !currentPlatforms.includes(p));
    if (added.length) throw new HttpError(400, `Can't add ${added.join(", ")}: there is no caption for it`, "platform_not_in_post");
    const droppedPublished = currentPlatforms.filter((p) => !next.includes(p) && results[p]?.status === "published");
    if (droppedPublished.length) {
      throw new HttpError(400, `${droppedPublished.join(", ")} already published this post`, "platform_published");
    }
    platforms = next;
    update.platforms = next;
  }

  let copies = current.copies;
  if (patch.captions) {
    try {
      copies = applyCaptionEdits(current.copies, platforms, patch.captions);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : "Invalid captions", "platform_not_in_post");
    }
    update.copies = copies;
  }
  let media = current.media;
  if (patch.media) {
    media = patch.media;
    update.media = patch.media;
  }
  if (patch.hook !== undefined) update.hook = patch.hook;
  const scheduledFor = patch.scheduledFor ? new Date(patch.scheduledFor).toISOString() : current.scheduled_for;
  if (patch.scheduledFor) update.scheduled_for = scheduledFor;

  let nextStatus = current.status;
  if (patch.status === "canceled") {
    nextStatus = "canceled";
  } else if (patch.status === "scheduled") {
    nextStatus = "scheduled";
    if (current.status === "draft") update.approved_at = ctx.now.toISOString();
    if (current.status === "failed" || current.status === "canceled") {
      update.publish_results = resetForRequeue(current.publish_results);
    }
    update.error = null;
    update.error_code = null;
  }
  if (nextStatus !== current.status) update.status = nextStatus;

  // Whatever ends up queued must be publishable exactly as written.
  if (nextStatus === "scheduled") {
    if (!ctx.entitled) {
      throw new HttpError(402, "Scheduling posts needs an active subscription on a plan that includes the social module", "plan_required");
    }
    const problems = schedulingProblems({ scheduledFor, platforms, copies, media, now: ctx.now });
    if (problems.length) {
      throw new HttpError(400, problems.map((p) => p.message).join("; "), problems[0].code);
    }
  }

  if (Object.keys(update).length === 0) throw new HttpError(400, "Nothing to change", "empty_patch");
  return { update, expectedStatus: current.status, nextStatus };
}
