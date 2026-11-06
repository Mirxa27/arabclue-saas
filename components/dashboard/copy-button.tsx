"use client";

/**
 * Copy-to-clipboard for values shown in Server Components (UI-002: a Server Component cannot pass
 * an onClick of its own; this island owns the handler).
 */
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useToast } from "@/components/ui/toast";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast("Copied / تم النسخ", "success");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Could not copy — select the text instead / تعذر النسخ", "error");
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="p-1 rounded hover:bg-paper-deep/50 transition-colors text-ink-mute hover:text-accent"
      title={label}
      aria-label={label}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}
