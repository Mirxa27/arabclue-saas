"use client";

import { useEffect, useState } from "react";
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
};

function toMarkdown(item: SeoContent): string {
  const p = item.payload ?? {};
  const parts = [`# ${p.title ?? "Untitled"}`];
  if (p.metaDescription) parts.push(`\n> ${p.metaDescription}`);
  if (p.slug) parts.push(`\n**Slug:** ${p.slug}`);
  if (p.description) parts.push(`\n${p.description}`);
  return parts.join("\n");
}

export function SeoContentPreview({ item, onClose, onDelete }: Props) {
  const [deleting, setDeleting] = useState(false);
  const reducedMotion = useReducedMotion();

  async function copyAll() {
    if (!item) return;
    await navigator.clipboard.writeText(toMarkdown(item));
  }

  async function deleteItem() {
    if (!item || !confirm("Delete this SEO content permanently?")) return;
    setDeleting(true);
    try {
      await onDelete(item.id);
      onClose();
    } finally {
      setDeleting(false);
    }
  }

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
            initial={reducedMotion ? false : { opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: 24, scale: 0.98 }}
            transition={fadeTransition(reducedMotion)}
            className="fixed inset-x-4 top-[10vh] bottom-[10vh] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-2xl bg-paper/95 backdrop-blur-xl border border-rule rounded-2xl shadow-xl z-50 flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-rule/50">
              <div className="flex items-center gap-2">
                <Badge>{item.kind}</Badge>
                <span className="font-medium truncate">{item.payload?.title ?? item.ref_id}</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-full hover:bg-paper-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                aria-label="Close preview"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 prose prose-neutral max-w-none">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-soft bg-paper-deep/30 p-4 rounded-xl border border-rule/40">
                {toMarkdown(item)}
              </pre>
            </div>
            <div className="p-4 border-t border-rule/50 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={copyAll}>
                <Copy size={14} /> Copy markdown
              </Button>
              <Button variant="danger" className="flex-1" onClick={deleteItem} disabled={deleting}>
                <Trash2 size={14} /> Delete
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
