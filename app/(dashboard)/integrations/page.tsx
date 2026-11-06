"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageShell } from "@/components/dashboard/page-shell";
import { PageIntro } from "@/components/dashboard/page-intro";
import {
  Card,
  Badge,
  Field,
  Input,
} from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useMerchant } from "@/hooks/use-merchant";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { ALL_PERSONAS, type Persona, type PlatformSlug } from "@/lib/agents/personas";
import type { IntegrationStatus } from "@/lib/integrations/status";
import { connectedBannerText } from "@/lib/integrations/labels";
import { sallaActionMessage, type BilingualText } from "@/lib/salla/messages";
import { cn } from "@/lib/utils";
import {
  Store,
  Instagram,
  MessageCircle,
  Music2,
  Linkedin,
  Twitter,
  Link2,
  Unlink2,
  RefreshCw,
  PlugZap,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Bot,
  Sparkles,
} from "lucide-react";

type SocialPlatform = "instagram" | "tiktok" | "x" | "linkedin" | "whatsapp";

type IntegrationCard = {
  name: string;
  icon: React.ElementType;
  desc: string;
  connected: boolean;
  platform?: SocialPlatform;
  oauthHref?: string;
  oauthLabel?: string;
};

const NO_OAUTH: IntegrationStatus["oauth_configured"] = { meta: false, linkedin: false, x: false, tiktok: false };

const STATUS_LOAD_FAILED: BilingualText = {
  ar: "تعذّر تحميل حالة الربط، فقد لا تكون الحالة المعروضة دقيقة.",
  en: "Couldn't load your connection status, so what's shown may be out of date.",
};

/** OAuth start route for a social platform (WhatsApp and Instagram both use the Meta flow). */
function socialStartHref(platform: SocialPlatform): string {
  if (platform === "instagram" || platform === "whatsapp") return `/api/oauth/meta/start?target=${platform}`;
  return `/api/oauth/${platform}/start`;
}

function bilingual(text: BilingualText): string {
  return `${text.ar} · ${text.en}`;
}

/** OAuth starts are browser navigations to route handlers: plain <a>, never <Link> (no prefetch). */
function StartLink({
  href,
  children,
  external = false,
  variant = "primary",
  compact = false,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
  variant?: "primary" | "outline";
  compact?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={cn(
        "inline-flex items-center justify-center tracking-crisp transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-300 select-none active:scale-[0.98]",
        compact
          ? "h-7 w-7 rounded-lg p-0"
          : "px-4 py-2 text-xs rounded-lg gap-1.5 font-mono uppercase tracking-wider font-semibold",
        variant === "primary"
          ? "bg-ink text-paper hover:bg-accent-deep shadow-[0_2px_10px_rgba(20,17,15,0.08)] active:bg-ink"
          : "border border-rule/50 text-ink-mute hover:text-ink hover:border-rule/80 bg-transparent"
      )}
    >
      {children}
    </a>
  );
}

/** POST to a Salla action route; failures resolve to the route's stable `code` (lib/salla/messages.ts). */
async function postSallaAction(
  url: string,
  body?: unknown
): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; code: string | null }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, json };
    if (typeof json.code === "string") return { ok: false, code: json.code };
    return { ok: false, code: res.status === 401 ? "not_signed_in" : res.status === 429 ? "rate_limited" : null };
  } catch {
    return { ok: false, code: "network" };
  }
}

function IntegrationsPageContent() {
  const { merchant, error: merchantError } = useMerchant();
  const { toast } = useToast();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [statusError, setStatusError] = useState<BilingualText | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [claiming, setClaiming] = useState(false);

  const [connectPlatform, setConnectPlatform] = useState<SocialPlatform>("instagram");
  const [externalId, setExternalId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  // The slug only selects a fixed label; it is never rendered itself.
  const connectedBanner = connectedBannerText(searchParams.get("connected"));
  const oauthError = searchParams.get("oauth") === "error";

  useEffect(() => {
    if (merchantError) toast(merchantError, "error");
  }, [merchantError, toast]);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      setStatus(await apiFetch<IntegrationStatus>("/api/integrations/status", { cache: "no-store" }));
      setStatusError(null);
    } catch {
      setStatusError(STATUS_LOAD_FAILED);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    if (!merchant) return;
    void loadStatus();
  }, [merchant, loadStatus]);

  const sallaConnected = status?.salla_connected ?? false;
  const sallaReconnect = status?.salla_reconnect_required ?? false;
  const sallaInstallURL = status?.salla_install_url ?? null;
  const sallaAppStore = status?.salla_connect_mode === "app_store";
  const pendingInstall = status?.salla_pending_install ?? null;
  const channelStatus: Record<string, boolean> = status?.channel_status ?? {};
  const oauthConfigured = status?.oauth_configured ?? NO_OAUTH;
  const socialOAuthEnabled = status?.social_oauth_enabled ?? true;

  async function syncProducts() {
    setSyncing(true);
    try {
      const result = await postSallaAction("/api/salla/products");
      if (result.ok) {
        const synced = Number(result.json.synced ?? 0);
        const more = result.json.truncated === true;
        toast(
          `تمت مزامنة ${synced} منتجًا من سلة${more ? " (الدفعة الأولى)" : ""} · Synced ${synced} products from Salla${more ? " (first batch)" : ""}`,
          "success"
        );
      } else {
        toast(bilingual(sallaActionMessage(result.code)), "error");
        if (result.code === "salla_reconnect_required" || result.code === "salla_not_connected") void loadStatus();
      }
    } finally {
      setSyncing(false);
    }
  }

  async function claimPendingInstall() {
    if (!pendingInstall) return;
    setClaiming(true);
    try {
      const result = await postSallaAction("/api/salla/installs/claim", { store_id: pendingInstall.store_id });
      if (result.ok) toast("تم ربط متجر سلة بحسابك · Your Salla store is now linked", "success");
      else toast(bilingual(sallaActionMessage(result.code)), "error");
      await loadStatus();
    } finally {
      setClaiming(false);
    }
  }

  async function connectSocialManual() {
    if (!connectPlatform || !externalId || !accessToken) {
      toast("Platform ID and access token are required", "error");
      return;
    }
    setConnecting(true);
    try {
      await apiFetch("/api/integrations/social/connect", {
        method: "POST",
        body: JSON.stringify({ platform: connectPlatform, externalId, accessToken }),
      });
      toast(`${connectPlatform} connected`, "success");
      window.location.href = "/integrations";
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Connect failed", "error");
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectChannel(platform: SocialPlatform) {
    setDisconnecting(platform);
    try {
      await apiFetch("/api/integrations/social/disconnect", {
        method: "POST",
        body: JSON.stringify({ platform }),
      });
      toast(`${platform} disconnected`, "success");
      window.location.href = "/integrations";
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Disconnect failed", "error");
    } finally {
      setDisconnecting(null);
    }
  }

  function platformConfigured(platform: SocialPlatform): boolean {
    if (platform === "instagram" || platform === "whatsapp") return oauthConfigured.meta;
    if (platform === "linkedin") return oauthConfigured.linkedin;
    if (platform === "x") return oauthConfigured.x;
    return oauthConfigured.tiktok;
  }

  function oauthAction(href: string | undefined, label: string, platform: SocialPlatform) {
    if (channelStatus[platform]) {
      return (
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={disconnecting === platform}
          onClick={() => disconnectChannel(platform)}
          className="text-red-400 border-red-400/20 hover:bg-red-400/10"
        >
          <Unlink2 size={13} />
          {disconnecting === platform ? "Disconnecting…" : "Disconnect"}
        </Button>
      );
    }
    if (!status) {
      return (
        <span className="text-[10px] text-ink-mute font-mono uppercase tracking-wider">
          {loadingStatus ? "…" : "Status unavailable"}
        </span>
      );
    }
    if (!socialOAuthEnabled || !platformConfigured(platform) || !href) {
      return (
        <span className="text-[10px] text-ink-mute font-mono tracking-wider">
          {!socialOAuthEnabled ? (
            <>
              <span className="font-arabic" lang="ar">معطّل من مسؤول المنصّة</span> · Disabled by admin
            </>
          ) : (
            <>
              <span className="font-arabic" lang="ar">غير مُعدّ على المنصّة</span> · Not configured on the platform
            </>
          )}
        </span>
      );
    }
    return (
      <StartLink href={href}>
        <Link2 size={13} />
        {label}
      </StartLink>
    );
  }

  const integrations: IntegrationCard[] = [
    {
      name: "Salla",
      icon: Store,
      desc: "OAuth into your Salla store to enable ZATCA invoicing and product sync.",
      connected: sallaConnected,
      oauthHref: sallaInstallURL ?? undefined,
      oauthLabel: sallaReconnect ? "Reconnect Salla" : "Connect Salla",
    },
    ...(["instagram", "whatsapp", "tiktok", "linkedin", "x"] as const).map((platform): IntegrationCard => ({
      name: { instagram: "Instagram", whatsapp: "WhatsApp Business", tiktok: "TikTok", linkedin: "LinkedIn", x: "X (Twitter)" }[platform],
      icon: { instagram: Instagram, whatsapp: MessageCircle, tiktok: Music2, linkedin: Linkedin, x: Twitter }[platform],
      platform,
      desc: {
        instagram: "Publish posts and hand off DMs/comments to the engager agent via Meta webhooks.",
        whatsapp: "Inbound WhatsApp messages route to the engager; escalations notify your ops desk.",
        tiktok: "OAuth + Content Posting API for scheduled video captions.",
        linkedin: "Post to your company page; inbound handled via bridge API.",
        x: "OAuth 2.0 user context for posting and agent handover.",
      }[platform],
      connected: channelStatus[platform] ?? false,
      oauthHref: socialStartHref(platform),
      oauthLabel: {
        instagram: "Connect Instagram",
        whatsapp: "Connect WhatsApp",
        tiktok: "Connect TikTok",
        linkedin: "Connect LinkedIn",
        x: "Connect X",
      }[platform],
    })),
  ];

  const connectedCount = integrations.filter((i) => i.connected).length;

  /** Persona platform → connected? (Salla comes from the store connection, not social channels.) */
  function platformConnected(plat: PlatformSlug): boolean {
    return plat === "salla" ? sallaConnected : channelStatus[plat] ?? false;
  }

  /** Persona quick-connect target for the first platform that can be connected now. */
  function personaConnectHref(p: Persona): { href: string; external: boolean } | null {
    if (!status) return null;
    for (const plat of p.platforms) {
      if (platformConnected(plat)) continue;
      if (plat === "salla") {
        if (sallaInstallURL) return { href: sallaInstallURL, external: sallaAppStore };
        continue;
      }
      if (socialOAuthEnabled && platformConfigured(plat)) return { href: socialStartHref(plat), external: false };
    }
    return null;
  }

  function renderSallaActions(card: IntegrationCard) {
    if (!status) {
      return (
        <span className="text-[10px] text-ink-mute font-mono uppercase tracking-wider">
          {loadingStatus ? "…" : "Status unavailable"}
        </span>
      );
    }
    if (sallaConnected) {
      return (
        <>
          {status.salla_store && (
            <span className="text-xs text-ink-mute" dir="auto">
              {status.salla_store.name ?? `#${status.salla_store.id}`}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={syncProducts} disabled={syncing}>
            <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing…" : "Sync products"}
          </Button>
        </>
      );
    }
    return (
      <div className="w-full space-y-3">
        {sallaReconnect && (
          <p className="text-xs leading-relaxed text-amber-600">
            <span className="block font-arabic" dir="rtl" lang="ar">
              انتهت صلاحية ربط سلة. أعد ربط متجرك لمتابعة الفوترة ومزامنة المنتجات.
            </span>
            <span className="block">Your Salla access has expired. Reconnect your store to keep invoicing and product sync running.</span>
          </p>
        )}
        {pendingInstall && (
          <div className="rounded-xl border border-accent/25 bg-accent/5 p-3 text-xs leading-relaxed space-y-2">
            <p className="font-arabic text-ink" dir="rtl" lang="ar">
              وجدنا تثبيتًا لتطبيقنا على متجر سلة بالبريد الإلكتروني لحسابك:{" "}
              <bdi className="font-semibold">{pendingInstall.store_name ?? `#${pendingInstall.store_id}`}</bdi>
            </p>
            <p className="text-ink-soft">
              We found an arabclue install on a Salla store made with your account&apos;s email:{" "}
              <bdi className="font-semibold">{pendingInstall.store_name ?? `#${pendingInstall.store_id}`}</bdi>
              {pendingInstall.store_domain && (
                <>
                  {" "}
                  (<bdi dir="ltr">{pendingInstall.store_domain}</bdi>)
                </>
              )}
            </p>
            <Button size="sm" type="button" onClick={claimPendingInstall} disabled={claiming}>
              <Link2 size={13} />
              {claiming ? "Linking…" : "Link this store"}
            </Button>
          </div>
        )}
        {card.oauthHref ? (
          <div className="flex flex-wrap items-center gap-2">
            <StartLink href={card.oauthHref} external={sallaAppStore}>
              <Link2 size={13} />
              {card.oauthLabel}
            </StartLink>
            {sallaAppStore && (
              <Button variant="outline" size="sm" type="button" onClick={() => void loadStatus()} disabled={loadingStatus}>
                <RefreshCw size={13} className={loadingStatus ? "animate-spin" : ""} />
                Check again
              </Button>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-ink-mute leading-relaxed">
            <span className="block font-arabic" dir="rtl" lang="ar">ربط سلة غير مُعدّ على المنصّة بعد.</span>
            <span className="block">Salla connection isn&apos;t configured on the platform yet.</span>
          </p>
        )}
        {sallaAppStore && card.oauthHref && (
          <p className="text-[11px] text-ink-mute leading-relaxed">
            <span className="block font-arabic" dir="rtl" lang="ar">
              ثبّت التطبيق من متجر تطبيقات سلة بالبريد نفسه، ثم عُد إلى هنا واضغط «تحقّق مجددًا».
            </span>
            <span className="block">Install the app from the Salla App Store with this same email, then come back and press “Check again”.</span>
          </p>
        )}
      </div>
    );
  }

  return (
    <PageShell title="Integrations" merchant={merchant}>
      <div className="space-y-6">
        <PageIntro
          kicker="Connections"
          title="Your commerce stack"
          description="Link Salla, social channels, and messaging so every arabclue agent reads the same catalog, orders, and brand voice."
          descriptionAr="اربط سلة وقنوات التواصل حتى يعمل كل موظف افتراضي على نفس بيانات المتجر وهوية العلامة."
        />

        <div className="dashboard-hero-strip ps-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="marker-numeral">Connection health</p>
              <p className="mt-1 text-lg font-semibold text-ink">
                <span className="nums text-accent">{status ? connectedCount : "—"}</span>
                <span className="text-ink-mute font-normal"> / {integrations.length} connected</span>
              </p>
            </div>
            {sallaConnected && (
              <Button variant="outline" size="sm" onClick={syncProducts} disabled={syncing}>
                <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
                {syncing ? "Syncing…" : "Sync Salla products"}
              </Button>
            )}
          </div>
        </div>

        {statusError && (
          <div
            role="alert"
            className="p-4 rounded-2xl border text-sm flex flex-wrap items-center gap-3 bg-red-400/5 border-red-400/20 text-red-400"
          >
            <AlertCircle size={18} />
            <div className="flex-1 min-w-0 space-y-0.5">
              <p className="font-arabic" dir="rtl" lang="ar">{statusError.ar}</p>
              <p>{statusError.en}</p>
            </div>
            <Button variant="outline" size="sm" type="button" onClick={() => void loadStatus()} disabled={loadingStatus}>
              <RefreshCw size={13} className={loadingStatus ? "animate-spin" : ""} />
              Retry
            </Button>
          </div>
        )}

        {(connectedBanner || oauthError) && (
          <div
            className={`p-4 rounded-2xl border text-sm flex items-center gap-3 ${
              oauthError
                ? "bg-red-400/5 border-red-400/20 text-red-400"
                : "bg-emerald-500/5 border-emerald-500/20 text-emerald-500"
            }`}
          >
            {oauthError ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            {oauthError ? (
              <div className="space-y-0.5">
                <p className="font-arabic" dir="rtl" lang="ar">تعذّر إكمال الربط. تحقّق من بيانات التطبيق وحاول مرة أخرى.</p>
                <p>OAuth connection failed. Check app credentials and try again.</p>
              </div>
            ) : connectedBanner ? (
              <div className="space-y-0.5">
                <p className="font-arabic" dir="rtl" lang="ar">{connectedBanner.ar}</p>
                <p>{connectedBanner.en}</p>
              </div>
            ) : null}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {integrations.map((i) => {
            const IconComp = i.icon;
            const reconnectBadge = i.name === "Salla" && sallaReconnect;
            return (
              <Card key={i.name} className="group">
                <div className="flex items-start gap-4">
                  <div
                    className={`w-10 h-10 rounded-2xl flex items-center justify-center border shrink-0 ${
                      i.connected
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"
                        : "bg-paper-deep/30 border-rule/30 text-ink-mute"
                    }`}
                  >
                    <IconComp size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-ink">{i.name}</h3>
                      <Badge tone={i.connected ? "success" : reconnectBadge ? "warn" : "default"} className="shrink-0">
                        {i.connected ? "Connected" : reconnectBadge ? "Reconnect needed" : "Not connected"}
                      </Badge>
                    </div>
                    <p className="text-xs text-ink-mute mt-1.5 leading-relaxed">{i.desc}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-4">
                      {i.name === "Salla"
                        ? renderSallaActions(i)
                        : i.platform
                          ? oauthAction(i.oauthHref, i.oauthLabel ?? "Connect", i.platform)
                          : null}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Setup wizard: agent persona cards */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent" />
            <h2 className="text-sm font-semibold text-ink">Agent personas</h2>
            <Badge tone="info">{ALL_PERSONAS.length} available</Badge>
          </div>
          <p className="text-xs text-ink-mute">
            Each agent persona is powered by specific platform integrations. Connect a platform to activate its agent.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ALL_PERSONAS.map((p: Persona) => {
              const personaConnected = p.platforms.some((plat) => platformConnected(plat));
              const quickConnect = personaConnected ? null : personaConnectHref(p);
              return (
                <Card
                  key={p.id}
                  className={`group transition-all ${
                    personaConnected
                      ? "border-emerald-500/20 bg-emerald-500/5"
                      : "hover:border-accent/20"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-lg ${
                        personaConnected
                          ? "bg-emerald-500/10 border border-emerald-500/30"
                          : "bg-paper-deep/30 border border-rule/30"
                      }`}
                    >
                      {p.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-xs font-semibold text-ink">{p.name}</h3>
                        <span className="text-[10px] text-ink-mute font-mono">
                          age {p.age}
                        </span>
                      </div>
                      <p className="text-[10px] text-ink-mute mt-0.5 leading-relaxed line-clamp-2">
                        {p.personality}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        {p.platforms.map((plat) => (
                          <span
                            key={plat}
                            className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
                              platformConnected(plat)
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                                : "bg-paper-deep/20 text-ink-mute border border-rule/20"
                            }`}
                          >
                            {plat}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {personaConnected ? (
                        <Badge tone="success" className="text-[10px]">
                          Active
                        </Badge>
                      ) : quickConnect ? (
                        <StartLink href={quickConnect.href} external={quickConnect.external} variant="outline" compact>
                          <ArrowRight size={12} />
                          <span className="sr-only">Connect {p.platforms.join(" / ")}</span>
                        </StartLink>
                      ) : (
                        <span className="text-[10px] text-ink-mute font-mono">{status ? "No keys" : "…"}</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-rule/30">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-ink-mute">
                        {p.tone} · {p.expertise}
                      </span>
                      {personaConnected && (
                        <Link
                          href={
                            p.dashboardRoute.startsWith("/social")
                              ? "/social"
                              : p.dashboardRoute.startsWith("/voice")
                                ? "/voice"
                                : p.dashboardRoute.startsWith("/seo")
                                  ? "/seo"
                                  : "/dashboard"
                          }
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-[10px] rounded-lg gap-1"
                          >
                            <Bot size={12} />
                            Open agent
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Manual token override */}
        <Card>
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
              <KeyRound size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-ink">Manual token override</h3>
              <p className="text-xs text-ink-mute mt-1.5 leading-relaxed">
                Use OAuth above when possible. Paste developer-console tokens only for sandbox or legacy apps.
              </p>
              <div className="grid sm:grid-cols-3 gap-4 mt-5">
                <Field label="Platform">
                  <select
                    className="w-full h-10 px-4 rounded-xl bg-paper-deep/20 border border-rule/40 text-sm text-ink focus:outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/10 transition-all"
                    value={connectPlatform}
                    onChange={(e) => setConnectPlatform(e.target.value as SocialPlatform)}
                  >
                    <option value="instagram">Instagram</option>
                    <option value="tiktok">TikTok</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="x">X</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                </Field>
                <Field label="External ID" hint="IG user ID, LinkedIn actor URN, WhatsApp phone ID, X user ID">
                  <Input value={externalId} onChange={(e) => setExternalId(e.target.value)} />
                </Field>
                <Field label="Access token">
                  <Input
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    type="password"
                  />
                </Field>
              </div>
              <div className="mt-4">
                <Button size="sm" onClick={connectSocialManual} disabled={connecting}>
                  <PlugZap size={13} />
                  {connecting ? "Connecting…" : "Save channel credentials"}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}

export default function IntegrationsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-ink-mute">Loading integrations…</div>}>
      <IntegrationsPageContent />
    </Suspense>
  );
}
