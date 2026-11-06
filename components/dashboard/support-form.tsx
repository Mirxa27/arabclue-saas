"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
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

/** Bounds of POST /api/support (lib/support/tickets.ts SupportBodySchema). */
const MESSAGE_MIN = 5;
const MESSAGE_MAX = 5000;

type FormStatus = "idle" | "submitting" | "success" | "error";

type SupportFormProps = {
  className?: string;
  /** Controlled open state (the dashboard chrome lifts it to hide the feedback widget). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the closed-state launcher (while the on-screen keyboard is up). */
  launcherHidden?: boolean;
};

/**
 * Support launcher + panel. The launcher is laid out by the chrome's FAB dock; the open panel
 * is fixed above the tab bar / keyboard / home indicator (`--chrome-bottom`), never taller than
 * the space left under the top safe area, and scrolls internally with a sticky header, so its
 * close button stays reachable in phone landscape and with the keyboard up (PANEL-01).
 */
export function SupportForm({ className, open: openProp, onOpenChange, launcherHidden = false }: SupportFormProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const [category, setCategory] = useState<Category>("help");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<FormStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const selectedCategory = CATEGORIES.find((c) => c.key === category)!;
  const trimmedLength = message.trim().length;

  function setOpen(next: boolean) {
    if (openProp === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  }

  function resetForm() {
    setCategory("help");
    setMessage("");
    setEmail("");
    setStatus("idle");
    setErrorMessage("");
    setShowCategoryPicker(false);
  }

  function close() {
    const active = document.activeElement;
    restoreFocus.current = !active || active === document.body || Boolean(panelRef.current?.contains(active));
    setOpen(false);
    resetForm();
  }

  // Escape closes the category picker, then the panel.
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (showCategoryPicker) setShowCategoryPicker(false);
      else closeRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, showCategoryPicker]);

  // After closing from inside the panel, focus returns to the launcher (it remounts).
  useEffect(() => {
    if (open || !restoreFocus.current) return;
    restoreFocus.current = false;
    launcherRef.current?.focus({ preventScroll: true });
  }, [open]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (trimmedLength < MESSAGE_MIN) return;

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
    if (launcherHidden) return null;
    return (
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-2 px-4 h-11 min-w-11 rounded-2xl",
          "bg-accent text-white shadow-glass-lg hover:bg-accent/90",
          "active:scale-95 transition-all duration-300",
          className,
        )}
        aria-label="Open support chat"
        aria-haspopup="dialog"
      >
        <Headset size={18} strokeWidth={2} aria-hidden />
        <span className="text-sm font-semibold hidden sm:inline">الدعم</span>
      </button>
    );
  }

  return (
    <div
      ref={panelRef}
      className={cn(
        "fixed bottom-[calc(0.75rem+var(--chrome-bottom))] end-[calc(1.5rem+var(--chrome-side))] z-50 lg:bottom-6",
        "w-[360px] max-w-[calc(100vw-2.5rem-2*var(--chrome-side))]",
        "max-h-[calc(100dvh-0.75rem-var(--chrome-bottom)-max(1rem,var(--safe-top)))] lg:max-h-[calc(100dvh-2.5rem)]",
        "overflow-y-auto overscroll-contain rounded-2xl border border-rule/50 bg-paper/98 backdrop-blur-2xl shadow-glass-xl",
        "animate-scale-in origin-bottom-right",
        className,
      )}
      role="dialog"
      aria-labelledby="support-form-title"
    >
      {/* Header (sticky: the close button stays in view while the body scrolls) */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-rule/30 bg-paper/98 px-5 py-2.5 backdrop-blur-2xl">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center">
            <MessageSquare size={16} strokeWidth={2} className="text-accent" aria-hidden />
          </div>
          <div>
            <h3 id="support-form-title" className="text-sm font-semibold text-ink">تواصل معنا</h3>
            <p className="text-[10px] text-ink-mute font-sans">نرد عادةً خلال يوم عمل واحد · Usually within one business day</p>
          </div>
        </div>
        <button
          type="button"
          onClick={close}
          className="-me-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-mute transition-colors hover:bg-paper-deep/50 hover:text-ink"
          aria-label="Close support"
        >
          <X size={16} strokeWidth={2} aria-hidden />
        </button>
      </div>

      {/* Body */}
      {status === "success" ? (
        <div className="flex flex-col items-center justify-center py-10 px-6 text-center gap-4">
          <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle2 size={28} strokeWidth={2} className="text-emerald-500" aria-hidden />
          </div>
          <h4 className="text-base font-semibold text-ink">تم الإرسال!</h4>
          <p className="text-xs text-ink-soft leading-relaxed">تلقينا استفسارك وسنرد عليك قريباً إن شاء الله.</p>
          <Button size="sm" variant="ghost" onClick={close}>
            إغلاق
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Category Picker */}
          <div>
            <span id="support-category-label" className="block text-[11px] font-semibold text-ink-mute mb-2 font-sans">
              نوع الطلب
            </span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowCategoryPicker(!showCategoryPicker)}
                aria-expanded={showCategoryPicker}
                aria-describedby="support-category-label"
                className={cn(
                  "flex items-center justify-between w-full px-3.5 min-h-11 rounded-xl border text-sm",
                  "bg-paper-deep/30 border-rule/50 hover:border-rule transition-colors duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                )}
              >
                <span className="flex items-center gap-2 text-ink">
                  <selectedCategory.icon size={15} strokeWidth={1.5} aria-hidden />
                  {selectedCategory.label}
                </span>
                <ChevronDown
                  size={14}
                  strokeWidth={2}
                  aria-hidden
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
                      aria-current={category === cat.key ? "true" : undefined}
                      onClick={() => {
                        setCategory(cat.key);
                        setShowCategoryPicker(false);
                      }}
                      className={cn(
                        "flex items-center gap-2.5 w-full px-3 min-h-11 text-sm rounded-lg transition-colors duration-150",
                        category === cat.key
                          ? "bg-accent/10 text-accent font-medium"
                          : "text-ink-soft hover:bg-paper-deep/50 hover:text-ink",
                      )}
                    >
                      <cat.icon size={15} strokeWidth={1.5} aria-hidden />
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
              autoComplete="email"
              enterKeyHint="next"
              maxLength={320}
              className={cn(
                "w-full px-3.5 h-11 rounded-xl border text-sm bg-paper-deep/30 border-rule/50",
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
              minLength={MESSAGE_MIN}
              maxLength={MESSAGE_MAX}
              dir="auto"
              aria-describedby={trimmedLength > 0 && trimmedLength < MESSAGE_MIN ? "support-message-hint" : undefined}
              className={cn(
                "w-full px-3.5 py-2.5 rounded-xl border text-sm bg-paper-deep/30 border-rule/50",
                "placeholder:text-ink-mute/50 text-ink resize-none",
                "hover:border-rule focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                "transition-colors duration-200",
              )}
            />
            {trimmedLength > 0 && trimmedLength < MESSAGE_MIN && (
              <p id="support-message-hint" className="mt-1.5 text-[11px] text-ink-mute">
                ٥ أحرف على الأقل · At least {MESSAGE_MIN} characters
              </p>
            )}
          </div>

          {/* Error */}
          {status === "error" && errorMessage && (
            <div role="alert" className="flex items-start gap-2 p-3 rounded-xl bg-red-500/5 border border-red-500/15 text-[11px] text-red-600">
              <AlertTriangle size={14} strokeWidth={2} className="shrink-0 mt-0.5" aria-hidden />
              <span dir="auto">{errorMessage}</span>
            </div>
          )}

          {/* Submit */}
          <Button
            type="submit"
            variant="primary"
            size="sm"
            className="w-full h-11 text-sm font-semibold gap-2"
            disabled={status === "submitting" || trimmedLength < MESSAGE_MIN}
          >
            {status === "submitting" ? (
              <>
                <Loader2 size={15} strokeWidth={2.5} className="animate-spin" aria-hidden />
                جارٍ الإرسال…
              </>
            ) : (
              <>
                <Send size={15} strokeWidth={2} aria-hidden />
                إرسال
              </>
            )}
          </Button>
        </form>
      )}
    </div>
  );
}
