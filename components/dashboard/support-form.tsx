"use client";

import { useState, useRef, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  MessageSquare,
  Send,
  X,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ChevronDown,
  Headset,
  Bug,
  Lightbulb,
  HelpCircle,
} from "lucide-react";

type Category = "help" | "bug" | "feature" | "billing";

const CATEGORIES: { key: Category; label: string; icon: typeof HelpCircle }[] = [
  { key: "help", label: "مساعدة عامة", icon: HelpCircle },
  { key: "bug", label: "الإبلاغ عن مشكلة", icon: Bug },
  { key: "feature", label: "اقتراح ميزة", icon: Lightbulb },
  { key: "billing", label: "استفسار عن الفاتورة", icon: Headset },
];

type FormStatus = "idle" | "submitting" | "success" | "error";

export function SupportForm({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>("help");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<FormStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedCategory = CATEGORIES.find((c) => c.key === category)!;

  function resetForm() {
    setCategory("help");
    setMessage("");
    setEmail("");
    setStatus("idle");
    setErrorMessage("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;

    setStatus("submitting");
    setErrorMessage("");

    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, message: message.trim(), email: email.trim() || undefined }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Server responded with ${res.status}`);
      }

      setStatus("success");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
      setStatus("error");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-6 end-6 z-50 flex items-center gap-2 px-4 h-11 rounded-2xl",
          "bg-accent text-white shadow-glass-lg hover:bg-accent/90",
          "active:scale-95 transition-all duration-300 touch-target",
          className,
        )}
        aria-label="Open support chat"
      >
        <Headset size={18} strokeWidth={2} />
        <span className="text-sm font-semibold hidden sm:inline">الدعم</span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "fixed bottom-6 end-6 z-50 w-[360px] max-w-[calc(100vw-2rem)]",
        "rounded-2xl border border-rule/50 bg-paper/98 backdrop-blur-2xl shadow-glass-xl",
        "animate-scale-in origin-bottom-right overflow-hidden",
        className,
      )}
      role="dialog"
      aria-label="Support form"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-rule/30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center">
            <MessageSquare size={16} strokeWidth={2} className="text-accent" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink">تواصل معنا</h3>
            <p className="text-[10px] text-ink-mute font-sans">نرد عادةً خلال ساعة</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            resetForm();
          }}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-mute hover:text-ink hover:bg-paper-deep/50 transition-colors"
          aria-label="Close support"
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>

      {/* Body */}
      {status === "success" ? (
        <div className="flex flex-col items-center justify-center py-10 px-6 text-center gap-4">
          <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle2 size={28} strokeWidth={2} className="text-emerald-500" />
          </div>
          <h4 className="text-base font-semibold text-ink">تم الإرسال!</h4>
          <p className="text-xs text-ink-soft leading-relaxed">تلقينا استفسارك وسنرد عليك قريباً إن شاء الله.</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setOpen(false);
              resetForm();
            }}
          >
            إغلاق
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Category Picker */}
          <div>
            <label className="block text-[11px] font-semibold text-ink-mute mb-2 font-sans">
              نوع الطلب
            </label>
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setShowCategoryPicker(!showCategoryPicker)}
                className={cn(
                  "flex items-center justify-between w-full px-3.5 h-10 rounded-xl border text-sm",
                  "bg-paper-deep/30 border-rule/50 hover:border-rule transition-colors duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                )}
              >
                <span className="flex items-center gap-2 text-ink">
                  <selectedCategory.icon size={15} strokeWidth={1.5} />
                  {selectedCategory.label}
                </span>
                <ChevronDown
                  size={14}
                  strokeWidth={2}
                  className={cn(
                    "text-ink-mute transition-transform duration-200",
                    showCategoryPicker && "rotate-180",
                  )}
                />
              </button>

              {showCategoryPicker && (
                <div className="absolute top-full mt-1.5 w-full bg-paper border border-rule/50 rounded-xl shadow-glass-lg p-1 z-10 animate-scale-in origin-top">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => {
                        setCategory(cat.key);
                        setShowCategoryPicker(false);
                      }}
                      className={cn(
                        "flex items-center gap-2.5 w-full px-3 py-2 text-sm rounded-lg transition-colors duration-150",
                        category === cat.key
                          ? "bg-accent/10 text-accent font-medium"
                          : "text-ink-soft hover:bg-paper-deep/50 hover:text-ink",
                      )}
                    >
                      <cat.icon size={15} strokeWidth={1.5} />
                      {cat.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Email */}
          <div>
            <label htmlFor="support-email" className="block text-[11px] font-semibold text-ink-mute mb-2 font-sans">
              البريد الإلكتروني <span className="text-ink-mute/50 font-normal">(اختياري)</span>
            </label>
            <input
              id="support-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className={cn(
                "w-full px-3.5 h-10 rounded-xl border text-sm bg-paper-deep/30 border-rule/50",
                "placeholder:text-ink-mute/50 text-ink",
                "hover:border-rule focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                "transition-colors duration-200",
              )}
              dir="ltr"
            />
          </div>

          {/* Message */}
          <div>
            <label htmlFor="support-message" className="block text-[11px] font-semibold text-ink-mute mb-2 font-sans">
              الرسالة
            </label>
            <textarea
              id="support-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="اكتب رسالتك هنا…"
              rows={4}
              required
              className={cn(
                "w-full px-3.5 py-2.5 rounded-xl border text-sm bg-paper-deep/30 border-rule/50",
                "placeholder:text-ink-mute/50 text-ink resize-none",
                "hover:border-rule focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                "transition-colors duration-200",
              )}
            />
          </div>

          {/* Error */}
          {status === "error" && errorMessage && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/5 border border-red-500/15 text-[11px] text-red-600">
              <AlertTriangle size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Submit */}
          <Button
            type="submit"
            variant="primary"
            size="sm"
            className="w-full h-11 text-sm font-semibold gap-2"
            disabled={status === "submitting" || !message.trim()}
          >
            {status === "submitting" ? (
              <>
                <Loader2 size={15} strokeWidth={2.5} className="animate-spin" />
                جارٍ الإرسال…
              </>
            ) : (
              <>
                <Send size={15} strokeWidth={2} />
                إرسال
              </>
            )}
          </Button>
        </form>
      )}
    </div>
  );
}