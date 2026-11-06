"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { platformMeta, type PlatformSlug } from "@/lib/agents/personas";
import { oauthErrorMessage } from "@/lib/oauth/errors";
import { parseOAuthResult, type OAuthResultPlatform } from "@/lib/oauth/result";

const REDIRECT_SECONDS = 3;

type Branding = { name: string; nameAr: string; color: string; icon: string };

const ARABIC_NAMES: Record<PlatformSlug, string> = {
  salla: "سلة",
  instagram: "إنستغرام",
  whatsapp: "واتساب",
  tiktok: "تيك توك",
  linkedin: "لينكدإن",
  x: "إكس",
};

const META_BRANDING: Branding = { name: "Instagram / WhatsApp", nameAr: "إنستغرام / واتساب", color: "#1877F2", icon: "∞" };
const GENERIC_BRANDING: Branding = { name: "the integration", nameAr: "التكامل", color: "#6B7280", icon: "🔗" };

function brandingFor(platform: OAuthResultPlatform | null): Branding {
  if (!platform) return GENERIC_BRANDING;
  if (platform === "meta") return META_BRANDING;
  const meta = platformMeta[platform];
  return meta ? { ...meta, nameAr: ARABIC_NAMES[platform] } : GENERIC_BRANDING;
}

/**
 * Result page for merchant-level OAuth connects (Salla, Instagram/WhatsApp, TikTok, LinkedIn, X).
 * Shows exactly what the callback reported: `status=success`, or the stable `error` code mapped
 * to fixed Arabic + English text (unknown codes → generic message; URL text is never shown).
 */
function OAuthResult() {
  const router = useRouter();
  const params = useSearchParams();
  const result = useMemo(() => parseOAuthResult(params), [params]);
  const brand = brandingFor(result.platform);
  const successHref = result.platform ? `/integrations?connected=${result.platform}` : "/integrations";
  const [countdown, setCountdown] = useState(REDIRECT_SECONDS);

  useEffect(() => {
    if (!result.ok) return;
    if (countdown <= 0) {
      router.replace(successHref);
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [result.ok, countdown, router, successHref]);

  const message = oauthErrorMessage(result.error);

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <Card className="w-full max-w-md p-8 text-center border-accent/20 bg-glass backdrop-blur-xl shadow-glass-xl">
        <div
          className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center text-2xl"
          style={{ background: brand.color + "15", color: brand.color }}
          aria-hidden
        >
          {brand.icon}
        </div>

        {result.ok ? (
          <div className="mt-6 space-y-4" role="status">
            <CheckCircle2 size={36} className="mx-auto text-emerald-500" aria-hidden />
            <div className="space-y-1">
              <h1 className="text-xl font-semibold text-ink font-arabic" dir="rtl" lang="ar">
                تم ربط {brand.nameAr} بنجاح
              </h1>
              <p className="text-sm text-ink-soft">{brand.name === GENERIC_BRANDING.name ? "Connected." : `${brand.name} is connected.`}</p>
            </div>
            <p className="flex items-center justify-center gap-1.5 text-xs text-ink-mute">
              <ShieldCheck size={14} aria-hidden /> Credentials are stored encrypted.
            </p>
            <p className="text-xs text-ink-mute">Redirecting in {Math.max(countdown, 0)}s…</p>
            <button
              type="button"
              onClick={() => router.replace(successHref)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent-deep transition-colors"
            >
              Continue <ArrowRight size={14} aria-hidden />
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-4" role="alert">
            <XCircle size={36} className="mx-auto text-red-500" aria-hidden />
            <div className="space-y-1">
              <h1 className="text-xl font-semibold text-ink font-arabic" dir="rtl" lang="ar">
                تعذّر ربط {brand.nameAr}
              </h1>
              <p className="text-sm text-ink-soft">Couldn&apos;t connect {brand.name}.</p>
            </div>
            <div className="rounded-xl border border-rule/40 bg-paper/50 px-4 py-3 text-sm leading-relaxed space-y-1">
              <p className="font-arabic text-ink" dir="rtl" lang="ar">
                {message.ar}
              </p>
              <p className="text-ink-soft">{message.en}</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <Link
                href="/integrations"
                className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-xs font-semibold text-paper hover:opacity-90 transition-opacity"
              >
                <span className="font-arabic" lang="ar">حاول مرة أخرى</span>
                <span aria-hidden>·</span>
                Try again
              </Link>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={<div className="min-h-[70vh]" />}>
      <OAuthResult />
    </Suspense>
  );
}
