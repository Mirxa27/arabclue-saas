"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ThumbsUp,
  ThumbsDown,
  MessageSquareText,
  X,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { browserStorage, hideFeedbackPrompt, isFeedbackPromptHidden } from "@/lib/ui/feedback-prompt";

type FeedbackSentiment = "up" | "down" | null;

const QUICK_REASONS: Record<string, string[]> = {
  up: [
    "التصميم رائع",
    "سهل الاستخدام",
    "وفر عليّ وقت",
    "الذكاء الاصطناعي مفيد",
    "أداء سريع",
  ],
  down: [
    "بطيء في التحميل",
    "أخطاء في النتائج",
    "الواجهة معقدة",
    "فقدان بيانات",
    "ميزة غير واضحة",
  ],
};

/** Bound of POST /api/feedback `note` (lib/support/tickets.ts FeedbackBodySchema). */
const NOTE_MAX = 2000;
/** How long the "thanks" pill stays before the launcher goes away. */
export const FEEDBACK_DONE_MS = 3000;

const SUBMIT_ERROR = "تعذّر إرسال ملاحظتك، حاول مرة أخرى · Couldn't send your feedback, please try again";

/**
 * closed  → only the 44px launcher (in the chrome's FAB dock), never a card over the page
 * idle / sentiment / feedback → the card, opened from the launcher
 * done    → a short "thanks" pill, then the launcher is gone for 30 days
 */
type WidgetStatus = "closed" | "idle" | "sentiment" | "feedback" | "done";

type FeedbackWidgetProps = {
  className?: string;
  /** Render nothing (the support panel is open). */
  hidden?: boolean;
  /** Hide the closed-state launcher (while the on-screen keyboard is up). */
  launcherHidden?: boolean;
};

export function FeedbackWidget({ className, hidden = false, launcherHidden = false }: FeedbackWidgetProps) {
  const [status, setStatus] = useState<WidgetStatus>("closed");
  // null until mounted: the dismissal lives in localStorage, which the server render cannot see.
  const [suppressed, setSuppressed] = useState<boolean | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sentiment, setSentiment] = useState<FeedbackSentiment>(null);
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [customNote, setCustomNote] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const launcherRef = useRef<HTMLButtonElement>(null);
  const cardOpen = status === "idle" || status === "sentiment" || status === "feedback";

  useEffect(() => {
    setSuppressed(isFeedbackPromptHidden(browserStorage(), Date.now()));
  }, []);

  // The thanks pill closes itself (it used to fall back to the full card).
  useEffect(() => {
    if (status !== "done") return;
    const timer = window.setTimeout(() => {
      setSuppressed(true);
      setStatus("closed");
    }, FEEDBACK_DONE_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  // Escape collapses the card back to the launcher.
  useEffect(() => {
    if (!cardOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setStatus("closed");
      launcherRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cardOpen]);

  function openCard() {
    setErrorMessage("");
    setStatus("idle");
  }

  /** The card's X: close it and keep the launcher away for 30 days. */
  function dismiss() {
    hideFeedbackPrompt(browserStorage(), "dismissed", Date.now());
    setSuppressed(true);
    setStatus("closed");
  }

  function openSentiment(s: FeedbackSentiment) {
    setSentiment(s);
    setSelectedReasons([]);
    setCustomNote("");
    setErrorMessage("");
    setStatus("sentiment");
  }

  function toggleReason(reason: string) {
    setSelectedReasons((prev) =>
      prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason],
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!sentiment || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentiment,
          reasons: selectedReasons,
          note: customNote.trim() || undefined,
          path: window.location.pathname,
        }),
      });

      if (!res.ok) throw new Error(`feedback ${res.status}`);

      hideFeedbackPrompt(browserStorage(), "submitted", Date.now());
      setStatus("done");
    } catch {
      setErrorMessage(SUBMIT_ERROR);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (hidden || suppressed === null) return null;

  if (status === "done") {
    return (
      <div
        role="status"
        className={cn(
          "flex items-center gap-2 px-4 h-11 rounded-2xl",
          "bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 backdrop-blur-xl",
          "text-xs font-medium animate-scale-in origin-bottom-right",
          className,
        )}
      >
        <CheckCircle2 size={14} strokeWidth={2} aria-hidden />
        <span className="whitespace-nowrap">شكراً لملاحظاتك! · Thanks!</span>
      </div>
    );
  }

  if (suppressed) return null;

  const errorNode = errorMessage ? (
    <p role="alert" className="text-[11px] text-red-500" dir="auto">
      {errorMessage}
    </p>
  ) : null;

  return (
    <>
      {!launcherHidden && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => (cardOpen ? setStatus("closed") : openCard())}
          aria-expanded={cardOpen}
          aria-controls={cardOpen ? "feedback-card" : undefined}
          aria-label="شاركنا رأيك · Share feedback"
          title="شاركنا رأيك · Share feedback"
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-2xl border border-rule/50 bg-paper/88 text-ink-soft shadow-glass-lg backdrop-blur-xl",
            "transition-all duration-300 hover:text-ink active:scale-95",
            cardOpen && "border-accent/30 text-accent",
            className,
          )}
        >
          <MessageSquareText size={18} strokeWidth={1.75} aria-hidden />
        </button>
      )}

      {cardOpen && (
        <div
          id="feedback-card"
          role="dialog"
          aria-labelledby="feedback-card-title"
          className={cn(
            "fixed end-[calc(1.5rem+var(--chrome-side))] z-50",
            launcherHidden
              ? "bottom-[calc(0.75rem+var(--chrome-bottom))] max-h-[calc(100dvh-0.75rem-var(--chrome-bottom)-max(1rem,var(--safe-top)))]"
              : "bottom-[calc(4.25rem+var(--chrome-bottom))] max-h-[calc(100dvh-4.25rem-var(--chrome-bottom)-max(1rem,var(--safe-top)))]",
            "lg:bottom-20 lg:max-h-[calc(100dvh-6rem)]",
            "w-[380px] max-w-[calc(100vw-2.5rem-2*var(--chrome-side))] overflow-y-auto overscroll-contain",
            "rounded-2xl border border-rule/40 bg-paper/98 backdrop-blur-2xl shadow-glass-xl",
            "animate-scale-in origin-bottom-right",
          )}
        >
          {/* Header with close */}
          <div className="flex items-center justify-between gap-2 ps-4 pe-2 pt-2 pb-1">
            <h4 id="feedback-card-title" className="text-sm font-semibold text-ink flex items-center gap-2">
              <MessageSquareText size={15} strokeWidth={1.5} className="text-ink-mute" aria-hidden />
              {status === "idle"
                ? "هل أعجبتك التجربة؟"
                : sentiment === "up"
                  ? "رائع! ما أكثر ما أعجبك؟"
                  : "نأسف لذلك. ما الذي يمكن تحسينه؟"}
            </h4>
            <button
              type="button"
              onClick={dismiss}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-mute transition-colors hover:bg-paper-deep/50 hover:text-ink"
              aria-label="إخفاء لمدة 30 يوماً · Hide for 30 days"
              title="إخفاء لمدة 30 يوماً · Hide for 30 days"
            >
              <X size={16} strokeWidth={2} aria-hidden />
            </button>
          </div>

          {/* Content */}
          {status === "idle" && (
            <div className="flex items-center justify-center gap-3 px-4 pb-4">
              <button
                type="button"
                onClick={() => openSentiment("up")}
                className={cn(
                  "flex items-center gap-2 px-5 h-11 rounded-xl text-sm font-medium",
                  "bg-emerald-500/5 text-emerald-600 hover:bg-emerald-500/10",
                  "active:scale-95 transition-all duration-150",
                )}
              >
                <ThumbsUp size={16} strokeWidth={2} aria-hidden />
                نعم
              </button>
              <button
                type="button"
                onClick={() => openSentiment("down")}
                className={cn(
                  "flex items-center gap-2 px-5 h-11 rounded-xl text-sm font-medium",
                  "bg-red-500/5 text-red-500 hover:bg-red-500/10",
                  "active:scale-95 transition-all duration-150",
                )}
              >
                <ThumbsDown size={16} strokeWidth={2} aria-hidden />
                لا
              </button>
            </div>
          )}

          {status === "sentiment" && sentiment && (
            <div className="space-y-3 px-4 pb-4">
              <div className="flex flex-wrap gap-1.5">
                {QUICK_REASONS[sentiment].map((reason) => {
                  const isSelected = selectedReasons.includes(reason);
                  return (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => toggleReason(reason)}
                      aria-pressed={isSelected}
                      className={cn(
                        "min-h-9 px-3 rounded-lg text-[11px] font-medium transition-all duration-150 [@media(pointer:coarse)]:min-h-11",
                        "active:scale-95",
                        isSelected
                          ? sentiment === "up"
                            ? "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30"
                            : "bg-red-500/15 text-red-500 border border-red-500/30"
                          : "bg-paper-deep/30 text-ink-soft border border-rule/30 hover:border-rule",
                      )}
                    >
                      {reason}
                    </button>
                  );
                })}
              </div>

              {errorNode}

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setStatus("feedback")}
                  className="min-h-11 text-[11px] font-medium"
                >
                  إضافة ملاحظة
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  onClick={handleSubmit}
                  className="min-h-11 text-[11px] font-medium"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <Loader2 size={13} strokeWidth={2.5} className="animate-spin" aria-hidden />
                  ) : (
                    "إرسال"
                  )}
                </Button>
              </div>
            </div>
          )}

          {status === "feedback" && sentiment && (
            <form onSubmit={handleSubmit} className="space-y-3 px-4 pb-4">
              {/* Show selected reasons */}
              {selectedReasons.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedReasons.map((r) => (
                    <span
                      key={r}
                      className={cn(
                        "inline-flex items-center rounded-lg ps-2 text-[10px] font-medium",
                        sentiment === "up"
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-red-500/10 text-red-500",
                      )}
                    >
                      {r}
                      <button
                        type="button"
                        onClick={() => toggleReason(r)}
                        className="flex h-8 w-8 items-center justify-center opacity-60 hover:opacity-100 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                        aria-label={`إزالة ${r} · Remove ${r}`}
                      >
                        <X size={12} strokeWidth={2.5} aria-hidden />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <textarea
                value={customNote}
                onChange={(e) => setCustomNote(e.target.value)}
                placeholder="أخبرنا المزيد…"
                rows={3}
                maxLength={NOTE_MAX}
                dir="auto"
                aria-label="ملاحظة إضافية · Additional note"
                className={cn(
                  "w-full px-3 py-2 rounded-xl border text-sm bg-paper-deep/30 border-rule/50",
                  "placeholder:text-ink-mute/50 text-ink resize-none",
                  "hover:border-rule focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                  "transition-colors duration-200",
                )}
              />

              {errorNode}

              <div className="flex items-center gap-2 justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setStatus("sentiment")}
                  className="min-h-11 text-[11px]"
                >
                  رجوع
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  className="min-h-11 text-[11px] font-medium"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <Loader2 size={13} strokeWidth={2.5} className="animate-spin" aria-hidden />
                  ) : (
                    "إرسال"
                  )}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </>
  );
}
