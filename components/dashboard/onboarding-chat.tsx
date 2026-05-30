"use client";

import { useState, useRef, useEffect } from "react";
import { Send, X, Sparkles, Loader2, ArrowDown } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface OnboardingChatContext {
  businessName?: string;
  vatNumber?: string;
  essence?: string;
  attributes?: string;
  dialect?: string;
  plan?: string;
}

interface OnboardingChatProps {
  step: number;
  context: OnboardingChatContext;
  open: boolean;
  onToggle: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function OnboardingChat({ step, context, open, onToggle }: OnboardingChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "أهلاً بك! أنا سارة، منسقة التهيئة في أرب كلو. اسألني أي سؤال عن خطوات التهيئة وأنا هنا لمساعدتك 💫",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages appear
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when chat opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  // Reset welcome message when step changes
  useEffect(() => {
    setMessages([
      {
        role: "assistant",
        content: getStepGreeting(step),
      },
    ]);
  }, [step]);

  function getStepGreeting(s: number): string {
    const greetings: Record<number, string> = {
      1: "أهلاً بك! أنا سارة، منسقة التهيئة في أرب كلو. هذه خطوة تسجيل المتجر — اسألني أي سؤال وأنا هنا لمساعدتك 💫",
      2: "خطوة تحديد هوية العلامة! هذه البيانات مهمة لنورة وسالم عشان يكتبوا ويتكلموا بصوت متجرك. كيف أقدر أساعدك؟",
      3: "حان وقت اختيار الباقة المناسبة لمتجرك. عندي معلومات عن كل باقة — اسألني!",
      4: "تعال تعرّف على فريقك الذكي! كل وكيل له شخصيته ولهجته الخاصة. عندك سؤال عن أي واحد منهم؟",
      5: "وصلنا للخطوة الأخيرة! 🎉 خلّني أراجع معك التفاصيل — اسألني أي شيء قبل ما ننتقل للدفع.",
    };
    return greetings[s] ?? greetings[1];
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/assistant/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step,
          context,
          messages: [...messages, userMsg].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Network error" }));
        throw new Error(err.error ?? "Failed to get response");
      }

      const data = await res.json();
      const reply: ChatMessage = {
        role: "assistant",
        content: data.reply ?? "عذراً، حدث خطأ. حاول مرة أخرى.",
      };
      setMessages((prev) => [...prev, reply]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "عذراً، واجهت مشكلة في الاتصال. تأكد من اتصالك بالإنترنت وحاول مرة أخرى.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink/30 backdrop-blur-sm z-40 transition-opacity"
        onClick={onToggle}
      />

      {/* Chat panel */}
      <div className="fixed bottom-6 right-6 z-50 w-[360px] max-w-[calc(100vw-2rem)] max-h-[560px] rounded-2xl bg-paper border border-rule shadow-xl flex flex-col overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rule/50 bg-paper-deep/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-accent-warm flex items-center justify-center text-paper text-sm font-bold shadow-sm">
              ✨
            </div>
            <div>
              <p className="text-xs font-bold text-ink leading-tight">سارة</p>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-success rounded-full" />
                <span className="text-[9px] font-mono text-ink-mute uppercase tracking-wider">
                  Online · Step {step}/5
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onToggle}
            className="p-1.5 rounded-lg hover:bg-rule/20 text-ink-mute hover:text-ink transition"
            aria-label="إغلاق المحادثة"
          >
            <X size={16} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[200px] max-h-[340px]">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed ${
                  msg.role === "user"
                    ? "bg-accent text-white rounded-br-md"
                    : "bg-paper-deep border border-rule/40 text-ink rounded-bl-md"
                }`}
                dir={msg.role === "assistant" ? "rtl" : "ltr"}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="max-w-[85%] px-3.5 py-3 rounded-2xl bg-paper-deep border border-rule/40 text-ink rounded-bl-md flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: "0s" }} />
                  <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: "0.15s" }} />
                  <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: "0.3s" }} />
                </div>
                <span className="text-[10px] font-mono text-ink-mute uppercase tracking-wider">
                  سارة تكتب...
                </span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-3 py-3 border-t border-rule/50 bg-paper">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="اسأل سارة..."
              className="flex-1 bg-paper-deep border border-rule/60 rounded-xl px-3.5 py-2.5 text-xs text-ink placeholder:text-ink-mute/50 outline-none focus:border-accent/50 transition text-right"
              dir="rtl"
              disabled={loading}
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="p-2.5 rounded-xl bg-accent text-white hover:bg-accent-deep disabled:opacity-40 disabled:cursor-not-allowed transition shrink-0"
              aria-label="إرسال"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Send size={16} />
              )}
            </button>
          </div>
          <p className="mt-1.5 text-[8px] font-mono text-ink-mute/60 text-center uppercase tracking-wider">
            اضغط Enter للإرسال · مدعوم بالذكاء الاصطناعي
          </p>
        </div>
      </div>
    </>
  );
}