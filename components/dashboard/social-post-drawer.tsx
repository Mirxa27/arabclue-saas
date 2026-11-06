"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { fadeTransition, slideTransition } from "@/lib/motion/transitions";
import { X, Trash2, CheckCircle2, RotateCcw, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Field, Input, Textarea } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";
import type { SocialPostSummary } from "@/lib/types/database";
import { CAPTION_LIMITS, captionFor, captionLength } from "@/lib/social/copies";
import {
  PLATFORM_STATUS_TEXT,
  POST_ERROR_TEXT,
  PUBLISH_CODE_TEXT,
  isPostErrorCode,
  parsePublishResults,
  type BilingualText
} from "@/lib/social/outcomes";
import { parsePostMedia } from "@/lib/social/media";
import { isPlatform, isPublishablePlatform, type Platform, type PostMedia } from "@/lib/social/types";
import { SOCIAL_STATUS_TEXT, socialStatusTone } from "@/components/dashboard/social-status";

type SocialPostDetail = SocialPostSummary & {
  copies?: Record<string, unknown>;
  media?: unknown;
  publish_results?: unknown;
  visual_brief?: unknown;
  error?: string | null;
  error_code?: string | null;
};

type Props = {
  postId: string | null;
  onClose: () => void;
  onUpdated: (patch: Partial<SocialPostSummary> & { id: string }) => void;
  onDeleted: (id: string) => void;
  /** Put a post back into the list (a failed delete). */
  onRestored: (post: SocialPostSummary) => void;
};

const PLATFORM_NAMES: Record<Platform, string> = {
  instagram: "Instagram",
  x: "X",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  whatsapp: "WhatsApp",
  snapchat: "Snapchat"
};

const both = (t: BilingualText) => `${t.ar} · ${t.en}`;

function toLocalInput(iso: string): string {
  const dt = new Date(iso);
  return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function errorText(err: unknown, fallback: BilingualText): string {
  return err instanceof ApiClientError && err.message ? err.message : both(fallback);
}

export function SocialPostDrawer({ postId, onClose, onUpdated, onDeleted, onRestored }: Props) {
  const { toast } = useToast();
  const reducedMotion = useReducedMotion();
  const [post, setPost] = useState<SocialPostDetail | null>(null);
  const [hook, setHook] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [captions, setCaptions] = useState<Partial<Record<Platform, string>>>({});
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [media, setMedia] = useState<PostMedia[]>([]);
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!postId) {
      setPost(null);
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const data = await apiFetch<SocialPostDetail>(`/api/social/post/${postId}`);
        const targets = (data.platforms ?? []).filter(isPlatform);
        setPost(data);
        setHook(data.hook ?? "");
        setScheduledFor(toLocalInput(data.scheduled_for));
        setPlatforms(targets);
        // One caption per platform: what each platform publishes is exactly what is shown here.
        setCaptions(Object.fromEntries(targets.map((p) => [p, captionFor(data.copies, p)])));
        setMedia(parsePostMedia(data.media));
        setImageUrl("");
      } catch (err) {
        toast(errorText(err, { ar: "تعذّر تحميل المنشور", en: "Failed to load post" }), "error");
        onClose();
      } finally {
        setLoading(false);
      }
    })();
  }, [postId, onClose, toast]);

  const results = useMemo(() => parsePublishResults(post?.publish_results), [post]);
  const status = post?.status ?? "draft";
  const editable = post ? ["draft", "scheduled", "failed", "canceled"].includes(status) : false;
  const hasInstagram = platforms.includes("instagram");

  function buildPatch(nextStatus?: "scheduled" | "canceled") {
    const original = (post?.platforms ?? []).filter(isPlatform);
    const changedCaptions = Object.fromEntries(
      platforms
        .filter((p) => (captions[p] ?? "") !== captionFor(post?.copies, p))
        .map((p) => [p, captions[p] ?? ""])
    );
    const nextMedia = imageUrl.trim() ? [...media, { url: imageUrl.trim() }] : media;
    return {
      ...(hook !== (post?.hook ?? "") ? { hook } : {}),
      ...(scheduledFor && toLocalInput(post!.scheduled_for) !== scheduledFor
        ? { scheduledFor: new Date(scheduledFor).toISOString() }
        : {}),
      ...(Object.keys(changedCaptions).length ? { captions: changedCaptions } : {}),
      ...(platforms.length !== original.length ? { platforms } : {}),
      ...(JSON.stringify(nextMedia) !== JSON.stringify(parsePostMedia(post?.media)) ? { media: nextMedia } : {}),
      ...(nextStatus ? { status: nextStatus } : {})
    };
  }

  async function submit(nextStatus?: "scheduled" | "canceled") {
    if (!postId || !post) return;
    const body = buildPatch(nextStatus);
    if (Object.keys(body).length === 0) {
      toast("لا توجد تغييرات · Nothing to change", "success");
      return;
    }
    setSaving(true);
    const previous: Partial<SocialPostSummary> & { id: string } = {
      id: postId,
      hook: post.hook,
      scheduled_for: post.scheduled_for,
      status: post.status,
      platforms: post.platforms
    };
    const optimistic: Partial<SocialPostSummary> & { id: string } = {
      id: postId,
      hook,
      platforms,
      ...(body.scheduledFor ? { scheduled_for: body.scheduledFor } : {}),
      ...(nextStatus ? { status: nextStatus } : {})
    };
    onUpdated(optimistic);
    try {
      const res = await apiFetch<{ ok: boolean; status: SocialPostSummary["status"]; agentActive?: boolean }>(
        `/api/social/post/${postId}`,
        { method: "PATCH", body: JSON.stringify(body) }
      );
      onUpdated({ id: postId, status: res.status });
      if (nextStatus === "scheduled" && res.agentActive === false) {
        toast(
          "جُدول المنشور، لكن وكيل التواصل الاجتماعي متوقف فلن يُنشر حتى تشغّله · Scheduled — but your social agent is off, so it won't publish until you switch it on",
          "error"
        );
      } else {
        toast(
          nextStatus === "scheduled"
            ? status === "draft"
              ? "تمت الموافقة والجدولة · Approved and scheduled"
              : "أُعيدت الجدولة · Re-queued"
            : nextStatus === "canceled"
              ? "أُلغي المنشور · Post canceled"
              : "حُفظ المنشور · Post saved",
          "success"
        );
      }
      onClose();
    } catch (err) {
      onUpdated(previous); // roll the list back: the server did not change the post
      toast(errorText(err, { ar: "تعذّر الحفظ", en: "Update failed" }), "error");
    } finally {
      setSaving(false);
    }
  }

  async function deletePost() {
    if (!postId || !post) return;
    const label =
      status === "published"
        ? "حذف المنشور من التقويم؟ لن يُحذف من المنصّة. · Delete from the calendar? It stays live on the platform."
        : "حذف هذا المنشور نهائيًا؟ · Delete this post permanently?";
    if (!confirm(label)) return;
    setSaving(true);
    const snapshot: SocialPostSummary = {
      id: post.id,
      hook: post.hook,
      platforms: post.platforms,
      scheduled_for: post.scheduled_for,
      status: post.status,
      goal: post.goal
    };
    onDeleted(postId);
    onClose();
    try {
      await apiFetch(`/api/social/post/${postId}`, { method: "DELETE" });
      toast("حُذف المنشور · Post deleted", "success");
    } catch (err) {
      onRestored(snapshot); // the post still exists: put it back
      toast(errorText(err, { ar: "تعذّر الحذف", en: "Delete failed" }), "error");
    } finally {
      setSaving(false);
    }
  }

  function togglePlatform(platform: Platform) {
    if (results[platform]?.status === "published") return; // already live there
    setPlatforms((prev) =>
      prev.includes(platform) ? (prev.length > 1 ? prev.filter((p) => p !== platform) : prev) : [...prev, platform]
    );
  }

  const statusText = SOCIAL_STATUS_TEXT[status] ?? { ar: status, en: status };

  return (
    <AnimatePresence>
      {postId && (
        <>
          <motion.div
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reducedMotion ? undefined : { opacity: 0 }}
            transition={fadeTransition(reducedMotion)}
            className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-40"
            onClick={onClose}
          />
          <motion.aside
            initial={reducedMotion ? false : { x: "100%" }}
            animate={{ x: 0 }}
            exit={reducedMotion ? undefined : { x: "100%" }}
            transition={slideTransition(reducedMotion)}
            className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-paper/95 backdrop-blur-xl border-s border-rule shadow-[-8px_0_30px_rgba(20,17,15,0.12)] z-50 flex flex-col"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-rule/50">
              <span className="font-mono text-xs uppercase tracking-widest text-ink-mute">
                <span className="font-arabic" lang="ar">مراجعة المنشور</span> · Review post
              </span>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-full hover:bg-paper-deep text-ink-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                aria-label="Close drawer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {loading || !post ? (
                <p className="text-sm text-ink-mute animate-pulse">Loading…</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={socialStatusTone(status)}>
                      <span className="font-arabic" lang="ar">{statusText.ar}</span> · {statusText.en}
                    </Badge>
                    {status === "draft" && (
                      <span className="text-xs text-ink-mute">
                        <span className="font-arabic" lang="ar">لن يُنشر قبل موافقتك</span> · Won&apos;t publish until you approve it
                      </span>
                    )}
                    {status === "publishing" && (
                      <span className="text-xs text-ink-mute">
                        <span className="font-arabic" lang="ar">يُنشر الآن</span> · Publishing now…
                      </span>
                    )}
                  </div>

                  {post.error_code && isPostErrorCode(post.error_code) && (
                    <div role="status" className="rounded-lg border border-accent-warm/30 bg-accent-warm/5 p-3 space-y-1">
                      <p className="text-sm text-ink">
                        <span className="font-arabic" lang="ar">{POST_ERROR_TEXT[post.error_code].ar}</span>
                        <span className="block text-ink-soft">{POST_ERROR_TEXT[post.error_code].en}</span>
                      </p>
                      {post.error && (
                        <p dir="auto" className="text-xs text-ink-mute break-words">
                          {post.error}
                        </p>
                      )}
                    </div>
                  )}
                  {!post.error_code && post.error && (
                    <p dir="auto" className="text-sm text-accent-warm-deep break-words">
                      {post.error}
                    </p>
                  )}

                  {Object.keys(results).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-mono uppercase tracking-wider text-ink-mute">
                        <span className="font-arabic" lang="ar">نتيجة النشر</span> · Publishing results
                      </p>
                      <ul className="space-y-2">
                        {(Object.entries(results) as Array<[Platform, NonNullable<(typeof results)[Platform]>]>).map(([platform, r]) => (
                          <li key={platform} className="rounded-lg border border-rule/40 p-2.5 text-xs space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-ink">{PLATFORM_NAMES[platform]}</span>
                              <Badge
                                tone={
                                  r.status === "published"
                                    ? "success"
                                    : r.status === "failed" || r.status === "unknown"
                                      ? "danger"
                                      : "default"
                                }
                              >
                                <span className="font-arabic" lang="ar">{PLATFORM_STATUS_TEXT[r.status].ar}</span> ·{" "}
                                {PLATFORM_STATUS_TEXT[r.status].en}
                              </Badge>
                            </div>
                            {r.code && (
                              <p className="text-ink-soft">
                                <span className="font-arabic" lang="ar">{PUBLISH_CODE_TEXT[r.code].ar}</span> ·{" "}
                                {PUBLISH_CODE_TEXT[r.code].en}
                              </p>
                            )}
                            {r.message && (
                              <p dir="auto" className="text-ink-mute break-words">
                                {r.message}
                              </p>
                            )}
                            {r.remoteId && <p className="font-mono text-ink-mute break-all">id: {r.remoteId}</p>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <Field label="Hook · الفكرة">
                    <Input dir="auto" value={hook} onChange={(e) => setHook(e.target.value)} disabled={!editable} />
                  </Field>
                  <Field label="Scheduled for · موعد النشر">
                    <Input
                      type="datetime-local"
                      value={scheduledFor}
                      onChange={(e) => setScheduledFor(e.target.value)}
                      disabled={!editable}
                    />
                  </Field>

                  <div className="space-y-2">
                    <p className="text-xs font-mono uppercase tracking-wider text-ink-mute">
                      <span className="font-arabic" lang="ar">المنصّات</span> · Platforms
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(post.platforms ?? []).filter(isPlatform).map((platform) => {
                        const on = platforms.includes(platform);
                        const locked = !editable || results[platform]?.status === "published";
                        return (
                          <button
                            key={platform}
                            type="button"
                            onClick={() => togglePlatform(platform)}
                            disabled={locked}
                            aria-pressed={on}
                            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                              on ? "border-accent/50 bg-accent/10 text-ink" : "border-rule/50 text-ink-mute line-through"
                            } disabled:opacity-60`}
                          >
                            {PLATFORM_NAMES[platform]}
                            {!isPublishablePlatform(platform) && " ⓘ"}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {platforms.map((platform) => {
                    const caption = captions[platform] ?? "";
                    const limit = CAPTION_LIMITS[platform];
                    const length = captionLength(platform, caption);
                    const over = limit !== undefined && length > limit;
                    return (
                      <Field
                        key={platform}
                        label={`Caption · ${PLATFORM_NAMES[platform]}`}
                        hint={
                          isPublishablePlatform(platform)
                            ? limit !== undefined
                              ? `${length} / ${limit}${platform === "x" ? " (emoji = 2, link = 23)" : ""}`
                              : undefined
                            : both(PUBLISH_CODE_TEXT.unsupported)
                        }
                      >
                        <Textarea
                          dir="auto"
                          rows={platform === "x" ? 4 : 6}
                          value={caption}
                          onChange={(e) => setCaptions((prev) => ({ ...prev, [platform]: e.target.value }))}
                          disabled={!editable}
                          aria-invalid={over}
                          className={over ? "border-red-500/60" : undefined}
                        />
                      </Field>
                    );
                  })}

                  {(hasInstagram || media.length > 0) && (
                    <div className="space-y-2">
                      <p className="text-xs font-mono uppercase tracking-wider text-ink-mute">
                        <span className="font-arabic" lang="ar">الصور</span> · Images
                      </p>
                      {media.length === 0 ? (
                        <p className="text-xs text-accent-warm-deep">{both(PUBLISH_CODE_TEXT.no_image)}</p>
                      ) : (
                        <ul className="grid grid-cols-3 gap-2">
                          {media.map((m) => (
                            <li key={m.url} className="relative">
                              {/* eslint-disable-next-line @next/next/no-img-element -- the merchant's own catalog image, shown as is */}
                              <img src={m.url} alt="" className="aspect-square w-full rounded-lg object-cover border border-rule/40" />
                              {editable && (
                                <button
                                  type="button"
                                  onClick={() => setMedia((prev) => prev.filter((x) => x.url !== m.url))}
                                  className="absolute top-1 end-1 rounded-full bg-paper/90 p-1 text-ink-soft"
                                  aria-label="Remove image"
                                >
                                  <X size={12} />
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {editable && (
                        <Field label="Add image URL (https, JPEG) · أضف رابط صورة">
                          <Input
                            dir="ltr"
                            inputMode="url"
                            placeholder="https://cdn.salla.sa/…"
                            value={imageUrl}
                            onChange={(e) => setImageUrl(e.target.value)}
                          />
                        </Field>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {post && (
              <div className="p-6 border-t border-rule/50 space-y-3 bg-paper-deep/20">
                {editable && (
                  <div className="flex gap-2">
                    <Button variant="ghost" className="flex-1" onClick={() => submit()} disabled={saving || loading}>
                      <span className="font-arabic" lang="ar">حفظ</span> · Save
                    </Button>
                    {status === "draft" && (
                      <Button className="flex-1" onClick={() => submit("scheduled")} disabled={saving || loading}>
                        <CheckCircle2 size={14} />
                        <span className="font-arabic" lang="ar">موافقة وجدولة</span> · Approve
                      </Button>
                    )}
                    {(status === "failed" || status === "canceled") && (
                      <Button className="flex-1" onClick={() => submit("scheduled")} disabled={saving || loading}>
                        <RotateCcw size={14} />
                        <span className="font-arabic" lang="ar">إعادة الجدولة</span> · Re-queue
                      </Button>
                    )}
                  </div>
                )}
                <div className="flex gap-2">
                  {(status === "draft" || status === "scheduled" || status === "failed") && (
                    <Button variant="ghost" className="flex-1" onClick={() => submit("canceled")} disabled={saving}>
                      <Ban size={14} />
                      <span className="font-arabic" lang="ar">إلغاء</span> · Cancel post
                    </Button>
                  )}
                  {status !== "publishing" && (
                    <Button variant="danger" className="flex-1" onClick={deletePost} disabled={saving}>
                      <Trash2 size={14} /> <span className="font-arabic" lang="ar">حذف</span> · Delete
                    </Button>
                  )}
                </div>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
