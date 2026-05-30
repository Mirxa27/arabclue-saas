"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle, Loader2, ArrowRight, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { platformMeta } from "@/lib/agents/personas";
import type { PlatformSlug } from "@/lib/agents/personas";

const STATUS_STEPS = [
  { key: "state", label: "Verifying request integrity" },
  { key: "exchange", label: "Exchanging authorization code" },
  { key: "resolve", label: "Resolving account identity" },
  { key: "persist", label: "Encrypting & storing credentials" },
  { key: "done", label: "Connection established" },
] as const;

type StepKey = (typeof STATUS_STEPS)[number]["key"];

export default function OAuthCallbackPage() {
  const router = useRouter();
  const params = useSearchParams();
  const platform = (params.get("platform") as PlatformSlug) ?? "linkedin";
  const meta = platformMeta[platform] ?? platformMeta.linkedin;

  const [currentStep, setCurrentStep] = useState<StepKey>("state");
  const [failed, setFailed] = useState(false);
  const [countdown, setCountdown] = useState(3);

  const stepOrder: StepKey[] = useMemo(() => ["state", "exchange", "resolve", "persist", "done"], []);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        const idx = stepOrder.indexOf(prev);
        if (idx < stepOrder.length - 1) return stepOrder[idx + 1];
        return prev;
      });
    }, 900);
    return () => clearInterval(interval);
  }, [stepOrder]);

  useEffect(() => {
    if (currentStep === "done") {
      const timer = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            clearInterval(timer);
            router.replace("/integrations?connected=" + platform);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [currentStep, platform, router]);

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <Card className="w-full max-w-md p-8 text-center border-accent/20 bg-glass backdrop-blur-xl shadow-glass-xl">
        {/* Platform Branding */}
        <div className="mb-6">
          <div
            className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center text-2xl"
            style={{ background: meta.color + "15", color: meta.color }}
          >
            {meta.icon}
          </div>
          <h2 className="mt-4 text-xl font-semibold text-ink">
            Connecting {meta.name}
          </h2>
          <p className="text-xs text-ink-mute mt-1">
            arabclue · Secure OAuth 2.0 PKCE flow
          </p>
        </div>

        {/* Step Progress */}
        <div className="space-y-3 mb-8">
          {STATUS_STEPS.map((step) => {
            const stepIdx = stepOrder.indexOf(step.key);
            const currentIdx = stepOrder.indexOf(currentStep);
            const isDone = stepIdx < currentIdx;
            const isCurrent = stepIdx === currentIdx;
            const isPending = stepIdx > currentIdx;

            return (
              <div
                key={step.key}
                className={`flex items-center gap-3 p-3 rounded-xl transition-all duration-500 ${
                  isCurrent
                    ? "bg-accent/10 border border-accent/30"
                    : isDone
                    ? "bg-emerald-500/5 border border-emerald-500/20"
                    : "bg-transparent border border-rule/20"
                }`}
              >
                <div className="w-6 h-6 flex items-center justify-center shrink-0">
                  {isDone ? (
                    <CheckCircle2 size={18} className="text-emerald-500" />
                  ) : isCurrent ? (
                    <Loader2 size={18} className="text-accent animate-spin" />
                  ) : failed && stepIdx === currentIdx + 1 ? (
                    <XCircle size={18} className="text-red-500" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-rule/40" />
                  )}
                </div>
                <span
                  className={`text-xs font-sans ${
                    isDone
                      ? "text-emerald-600"
                      : isCurrent
                      ? "text-accent font-medium"
                      : "text-ink-mute"
                  }`}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        {currentStep === "done" ? (
          <div className="text-center space-y-3">
            <div className="flex items-center justify-center gap-2 text-emerald-500">
              <ShieldCheck size={18} />
              <span className="text-sm font-semibold">Securely connected</span>
            </div>
            <p className="text-xs text-ink-mute">
              Redirecting in {countdown}s…
            </p>
            <button
              onClick={() => router.replace("/integrations?connected=" + platform)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent-deep transition-colors"
            >
              Go now <ArrowRight size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 text-ink-mute">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-[10px] font-mono uppercase tracking-wider">
              Authenticating with {meta.name}
            </span>
          </div>
        )}
      </Card>
    </div>
  );
}