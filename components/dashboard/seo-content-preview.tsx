"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { fadeTransition } from "@/lib/motion/transitions";
import { Copy, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import type { SeoContent } from "@/lib/types/database";

type Props = {
  item: SeoContent | null;
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
  /** False for content that was generated but could not be saved (nothing to delete). */
  canDelete?: boolean;
};

const KIND_LABEL: Record<string, string> = {
  product: "منتج · Product",
  blog: "مقال · Blog",
  meta: "Meta"
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];
}

/** Every field the SEO generator writes (product copy and blog posts), as markdown. */
export function seoContentMarkdown(item: SeoContent): string {
  const p = (item.payload ?? {}) as Record<string, unknown>;
  const parts = [`# ${str(p.title) ?? item.ref_id ?? "Untitled"}`];
  const meta = str(p.metaDescription);
  if (meta) parts.push(`> ${meta}`);
  const slug = str(p.slug);
  if (slug) parts.push(`**Slug:** ${slug}`);
  const description = str(p.description);
  if (description) parts.push(description);
  const bullets = list(p.bullets);
  if (bullets.length) parts.push(bullets.map((b) => `- ${b}`).join("\n"));
  const outline = list(p.outline);
  if (outline.length) parts.push(`## Outline\n${outline.map((o) => `- ${o}`).join("\n")}`);
  const body = str(p.body);
  if (body) parts.push(body);
  const keywords = list(p.keywords);
  if (keywords.length) parts.push(`**Keywords:** ${keywords.join("، ")}`);
  const alt = str(p.altText);
  if (alt) parts.push(`**Alt text:** ${alt}`);
  const links = list(p.internalLinkSuggestions);
  if (links.length) parts.push(`**Internal links:** ${links.join(" · ")}`);
  return parts.join("\n\n");
}

export function SeoContentPreview({ item, onClose, onDelete, canDelete = true }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const reducedMotion = useReducedMotion();

  async function copyAll() {
    if (!item) return;
    try {
      await navigator.clipboard.writeText(seoContentMarkdown(item));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  async function deleteItem() {
    if (!item || !confirm("حذف هذا المحتوى نهائياً؟ · Delete this SEO content permanently?")) return;
    setDeleting(true);
    try {
      await onDelete(item.id);
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  const title = item ? str((item.payload as Record<string, unknown> | null)?.title) ?? item.ref_id : null;

  return (
    <AnimatePresence>
      {item && (
        <>
          <motion.div
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reducedMotion ? undefined : { opacity: 0 }}
            transition={fadeTransition(reducedMotion)}
            className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-40"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="SEO content preview"
            initial={reducedMotion ? false : { opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: 24, scale: 0.98 }}
            transition={fadeTransition(reducedMotion)}
            className="fixed inset-x-4 top-[10vh] bottom-[10vh] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-2xl bg-paper/95 backdrop-blur-xl border border-rule rounded-2xl shadow-xl z-50 flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-rule/50">
              <div className="flex items-center gap-2 min-w-0">
                <Badge>{KIND_LABEL[item.kind] ?? item.kind}</Badge>
                <span className="font-medium truncate" dir="auto">{title}</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-full hover:bg-paper-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                aria-label="إغلاق · Close preview"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 prose prose-neutral max-w-none">
              <pre
                dir="auto"
                className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-soft bg-paper-deep/30 p-4 rounded-xl border border-rule/40"
              >
                {seoContentMarkdown(item)}
              </pre>
            </div>
            <div className="p-4 border-t border-rule/50 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={copyAll}>
                <Copy size={14} /> {copied ? "تم النسخ · Copied" : "نسخ · Copy markdown"}
              </Button>
              {canDelete && (
                <Button variant="danger" className="flex-1" onClick={deleteItem} disabled={deleting}>
                  <Trash2 size={14} /> {deleting ? "جارٍ الحذف… · Deleting…" : "حذف · Delete"}
                </Button>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
