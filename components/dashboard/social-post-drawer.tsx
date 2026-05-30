"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { fadeTransition, slideTransition } from "@/lib/motion/transitions";
import { X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Field, Input, Textarea } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";
import type { SocialPostSummary } from "@/lib/types/database";

type SocialPostDetail = SocialPostSummary & {
  copies?: Record<string, { caption?: string; body?: string }>;
  visual_brief?: unknown;
  error?: string | null;
};

type Props = {
  postId: string | null;
  onClose: () => void;
  onUpdated: (patch: Partial<SocialPostSummary> & { id: string }) => void;
  onDeleted: (id: string) => void;
};

export function SocialPostDrawer({ postId, onClose, onUpdated, onDeleted }: Props) {
  const { toast } = useToast();
  const reducedMotion = useReducedMotion();
  const [post, setPost] = useState<SocialPostDetail | null>(null);
  const [hook, setHook] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [caption, setCaption] = useState("");
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
        setPost(data);
        setHook(data.hook ?? "");
        const dt = new Date(data.scheduled_for);
        const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        setScheduledFor(local);
        const firstPlatform = data.platforms[0];
        const rawCopy = firstPlatform ? data.copies?.[firstPlatform] : undefined;
        const copy = rawCopy && typeof rawCopy === "object" ? rawCopy : undefined;
        setCaption(copy?.caption ?? copy?.body ?? data.hook ?? "");
      } catch (err) {
        toast(err instanceof ApiClientError ? err.message : "Failed to load post", "error");
        onClose();
      } finally {
        setLoading(false);
      }
    })();
  }, [postId, onClose, toast]);

  async function save() {
    if (!postId || !post) return;
    setSaving(true);
    const prev = { ...post, hook, scheduled_for: post.scheduled_for };
    const iso = new Date(scheduledFor).toISOString();
    const platform = post.platforms[0];
    const copies = platform
      ? { ...post.copies, [platform]: { ...(post.copies?.[platform] ?? {}), caption } }
      : post.copies;

    onUpdated({ id: postId, hook, scheduled_for: iso });
    onClose();

    try {
      await apiFetch(`/api/social/post/${postId}`, {
        method: "PATCH",
        body: JSON.stringify({
          scheduledFor: iso,
          hook,
          copies
        })
      });
      toast("Post updated", "success");
    } catch (err) {
      onUpdated(prev);
      toast(err instanceof ApiClientError ? err.message : "Update failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function cancelPost() {
    if (!postId) return;
    setSaving(true);
    onUpdated({ id: postId, status: "canceled" });
    onClose();
    try {
      await apiFetch(`/api/social/post/${postId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "canceled" })
      });
      toast("Post canceled", "success");
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Cancel failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function deletePost() {
    if (!postId || !confirm("Delete this scheduled post permanently?")) return;
    setSaving(true);
    onDeleted(postId);
    onClose();
    try {
      await apiFetch(`/api/social/post/${postId}`, { method: "DELETE" });
      toast("Post deleted", "success");
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Delete failed", "error");
    } finally {
      setSaving(false);
    }
  }

  const editable = post && !["published", "publishing"].includes(post.status);

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
              <span className="font-mono text-xs uppercase tracking-widest text-ink-mute">Edit post</span>
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
                  <div className="flex flex-wrap gap-2">
                    {post.platforms.map((pl) => (
                      <Badge key={pl}>{pl}</Badge>
                    ))}
                    <Badge tone={post.status === "published" ? "success" : post.status === "failed" ? "danger" : "default"}>
                      {post.status}
                    </Badge>
                  </div>
                  <Field label="Hook">
                    <Input value={hook} onChange={(e) => setHook(e.target.value)} disabled={!editable} />
                  </Field>
                  <Field label="Scheduled for">
                    <Input
                      type="datetime-local"
                      value={scheduledFor}
                      onChange={(e) => setScheduledFor(e.target.value)}
                      disabled={!editable}
                    />
                  </Field>
                  <Field label="Caption">
                    <Textarea rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} disabled={!editable} />
                  </Field>
                  {post.error && <p className="text-sm text-accent-warm-deep">{post.error}</p>}
                </>
              )}
            </div>

            {post && editable && (
              <div className="p-6 border-t border-rule/50 space-y-3 bg-paper-deep/20">
                <Button className="w-full" onClick={save} disabled={saving || loading}>
                  Save changes
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" className="flex-1" onClick={cancelPost} disabled={saving || post.status === "canceled"}>
                    Cancel post
                  </Button>
                  <Button variant="danger" className="flex-1" onClick={deletePost} disabled={saving}>
                    <Trash2 size={14} /> Delete
                  </Button>
                </div>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
