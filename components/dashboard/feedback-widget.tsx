"use client";

import { useState, type FormEvent } from "react";
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

type WidgetStatus = "idle" | "sentiment" | "feedback" | "done";

export function FeedbackWidget({ className }: { className?: string }) {
  const [status, setStatus] = useState<WidgetStatus>("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sentiment, setSentiment] = useState<FeedbackSentiment>(null);
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [customNote, setCustomNote] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

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

      if (!res.ok) throw new Error("Failed to submit");

      setStatus("done");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
      setStatus(sentiment ? "sentiment" : "idle");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (status === "done") {
    return (
      <div
        className={cn(
          "fixed bottom-[calc(9rem+var(--safe-bottom))] lg:bottom-28 end-6 z-50 flex items-center gap-2 px-4 h-10 rounded-2xl",
          "bg-emerald-500/10 border border-emerald-500/20 text-emerald-600",
          "text-xs font-medium animate-scale-in origin-bottom-right",
          className,
        )}
      >
        <CheckCircle2 size={14} strokeWidth={2} />
        شكراً لملاحظاتك!
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="ms-1 text-emerald-500/60 hover:text-emerald-600 transition-colors"
          aria-label="Dismiss"
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "fixed bottom-[calc(9rem+var(--safe-bottom))] lg:bottom-28 end-6 z-50 max-w-[380px] w-[calc(100vw-2rem)]",
        "rounded-2xl border border-rule/40 bg-paper/98 backdrop-blur-2xl shadow-glass-xl",
        "animate-scale-in origin-bottom-right overflow-hidden",
        className,
      )}
    >
      {/* Header with close */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h4 className="text-sm font-semibold text-ink flex items-center gap-2">
          <MessageSquareText size={15} strokeWidth={1.5} className="text-ink-mute" />
          {status === "idle"
            ? "هل أعجبتك التجربة؟"
            : sentiment === "up"
              ? "رائع! ما أكثر ما أعجبك؟"
              : "نأسف لذلك. ما الذي يمكن تحسينه؟"}
        </h4>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="text-ink-mute hover:text-ink transition-colors"
          aria-label="Close"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      {/* Content */}
      {status === "idle" && (
        <div className="flex items-center justify-center gap-3 px-4 pb-4">
          <button
            type="button"
            onClick={() => openSentiment("up")}
            className={cn(
              "flex items-center gap-2 px-5 h-10 rounded-xl text-sm font-medium",
              "bg-emerald-500/5 text-emerald-600 hover:bg-emerald-500/10",
              "active:scale-95 transition-all duration-150",
            )}
          >
            <ThumbsUp size={16} strokeWidth={2} />
            نعم
          </button>
          <button
            type="button"
            onClick={() => openSentiment("down")}
            className={cn(
              "flex items-center gap-2 px-5 h-10 rounded-xl text-sm font-medium",
              "bg-red-500/5 text-red-500 hover:bg-red-500/10",
              "active:scale-95 transition-all duration-150",
            )}
          >
            <ThumbsDown size={16} strokeWidth={2} />
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
                  className={cn(
                    "px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-150",
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

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setStatus("feedback")}
              className="h-9 text-[11px] font-medium"
            >
              إضافة ملاحظة
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={handleSubmit}
              className="h-9 text-[11px] font-medium"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 size={13} strokeWidth={2.5} className="animate-spin" />
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
                    "px-2 py-0.5 rounded-lg text-[10px] font-medium",
                    sentiment === "up"
                      ? "bg-emerald-500/10 text-emerald-600"
                      : "bg-red-500/10 text-red-500",
                  )}
                >
                  {r}
                  <button
                    type="button"
                    onClick={() => toggleReason(r)}
                    className="ms-1 opacity-50 hover:opacity-100"
                    aria-label={`Remove ${r}`}
                  >
                    ×
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
            className={cn(
              "w-full px-3 py-2 rounded-xl border text-sm bg-paper-deep/30 border-rule/50",
              "placeholder:text-ink-mute/50 text-ink resize-none",
              "hover:border-rule focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
              "transition-colors duration-200",
            )}
          />

          {errorMessage && (
            <p className="text-[11px] text-red-500">{errorMessage}</p>
          )}

          <div className="flex items-center gap-2 justify-end">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setStatus("sentiment")}
              className="h-8 text-[11px]"
            >
              رجوع
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="primary"
              className="h-8 text-[11px] font-medium"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 size={13} strokeWidth={2.5} className="animate-spin" />
              ) : (
                "إرسال"
              )}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}