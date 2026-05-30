"use client";

import { useEffect, useState, Suspense } from "react";
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
import { ALL_PERSONAS, type Persona } from "@/lib/agents/personas";
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

function IntegrationsPageContent() {
  const { merchant, error: merchantError } = useMerchant();
  const { toast } = useToast();
  const searchParams = useSearchParams();

  const [sallaConnected, setSallaConnected] = useState(false);
  const [sallaInstallURL, setSallaInstallURL] = useState("#");
  const [channelStatus, setChannelStatus] = useState<Record<string, boolean>>({});
  const [oauthConfigured, setOauthConfigured] = useState({
    meta: false,
    linkedin: false,
    x: false,
    tiktok: false,
  });
  const [socialOAuthEnabled, setSocialOAuthEnabled] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [connectPlatform, setConnectPlatform] = useState<SocialPlatform>("instagram");
  const [externalId, setExternalId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const connectedParam = searchParams.get("connected");
  const oauthError = searchParams.get("oauth") === "error";

  useEffect(() => {
    if (merchantError) toast(merchantError, "error");
  }, [merchantError, toast]);

  useEffect(() => {
    if (!merchant) return;
    (async () => {
      try {
        const json = await apiFetch<{
          salla_connected?: boolean;
          salla_install_url?: string;
          channel_status?: Record<string, boolean>;
          oauth_configured?: typeof oauthConfigured;
          social_oauth_enabled?: boolean;
        }>("/api/integrations/status");

        setSallaConnected(json.salla_connected ?? !!merchant.access_token);
        setSallaInstallURL(json.salla_install_url ?? "#");
        setChannelStatus(json.channel_status ?? {});
        if (json.oauth_configured) setOauthConfigured(json.oauth_configured);
        setSocialOAuthEnabled(json.social_oauth_enabled ?? true);
      } catch {
        setSallaConnected(!!merchant.access_token);
      }
    })();
  }, [merchant]);

  async function syncProducts() {
    setSyncing(true);
    try {
      const res = await apiFetch<{ synced: number }>("/api/salla/products", { method: "POST" });
      toast(`Synced ${res.synced} products from Salla`, "success");
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Sync failed", "error");
    } finally {
      setSyncing(false);
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

  function oauthAction(
    href: string | undefined,
    label: string,
    platform: SocialPlatform,
    configured: boolean
  ) {
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
    if (!configured || !href) {
      return (
        <span className="text-[10px] text-ink-mute font-mono uppercase tracking-wider">
          {!socialOAuthEnabled ? "Disabled by admin" : "Missing API keys"}
        </span>
      );
    }
    return (
      <Link href={href}>
        <Button size="sm" type="button">
          <Link2 size={13} />
          {label}
        </Button>
      </Link>
    );
  }

  const integrations: IntegrationCard[] = [
    {
      name: "Salla",
      icon: Store,
      desc: "OAuth into your Salla store to enable ZATCA invoicing and product sync.",
      connected: sallaConnected,
      oauthHref: sallaInstallURL,
      oauthLabel: "Connect Salla",
    },
    {
      name: "Instagram",
      icon: Instagram,
      platform: "instagram",
      desc: "Publish posts and hand off DMs/comments to the engager agent via Meta webhooks.",
      connected: channelStatus.instagram ?? false,
      oauthHref: oauthConfigured.meta ? "/api/oauth/meta/start?target=instagram" : undefined,
      oauthLabel: "Connect Instagram",
    },
    {
      name: "WhatsApp Business",
      icon: MessageCircle,
      platform: "whatsapp",
      desc: "Inbound WhatsApp messages route to the engager; escalations notify your ops desk.",
      connected: channelStatus.whatsapp ?? false,
      oauthHref: oauthConfigured.meta ? "/api/oauth/meta/start?target=whatsapp" : undefined,
      oauthLabel: "Connect WhatsApp",
    },
    {
      name: "TikTok",
      icon: Music2,
      platform: "tiktok",
      desc: "OAuth + Content Posting API for scheduled video captions.",
      connected: channelStatus.tiktok ?? false,
      oauthHref: oauthConfigured.tiktok ? "/api/oauth/tiktok/start" : undefined,
      oauthLabel: "Connect TikTok",
    },
    {
      name: "LinkedIn",
      icon: Linkedin,
      platform: "linkedin",
      desc: "Post to your company page; inbound handled via bridge API.",
      connected: channelStatus.linkedin ?? false,
      oauthHref: oauthConfigured.linkedin ? "/api/oauth/linkedin/start" : undefined,
      oauthLabel: "Connect LinkedIn",
    },
    {
      name: "X (Twitter)",
      icon: Twitter,
      platform: "x",
      desc: "OAuth 2.0 user context for posting and agent handover.",
      connected: channelStatus.x ?? false,
      oauthHref: oauthConfigured.x ? "/api/oauth/x/start" : undefined,
      oauthLabel: "Connect X",
    },
  ];

  const connectedCount = integrations.filter((i) => i.connected).length;

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
                <span className="nums text-accent">{connectedCount}</span>
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

        {(connectedParam || oauthError) && (
          <div
            className={`p-4 rounded-2xl border text-sm flex items-center gap-3 ${
              oauthError
                ? "bg-red-400/5 border-red-400/20 text-red-400"
                : "bg-emerald-500/5 border-emerald-500/20 text-emerald-500"
            }`}
          >
            {oauthError ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            {oauthError
              ? "OAuth connection failed. Check app credentials and try again."
              : `${connectedParam} connected successfully.`}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {integrations.map((i) => {
            const IconComp = i.icon;
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
                      <Badge tone={i.connected ? "success" : "default"} className="shrink-0">
                        {i.connected ? "Connected" : "Not connected"}
                      </Badge>
                    </div>
                    <p className="text-xs text-ink-mute mt-1.5 leading-relaxed">{i.desc}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-4">
                      {i.name === "Salla" ? (
                        <>
                          {!sallaConnected && i.oauthHref && (
                            <Link href={i.oauthHref}>
                              <Button size="sm">
                                <Link2 size={13} />
                                {i.oauthLabel}
                              </Button>
                            </Link>
                          )}
                          {sallaConnected && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={syncProducts}
                              disabled={syncing}
                            >
                              <RefreshCw
                                size={13}
                                className={syncing ? "animate-spin" : ""}
                              />
                              {syncing ? "Syncing…" : "Sync products"}
                            </Button>
                          )}
                        </>
                      ) : i.platform ? (
                        oauthAction(
                          i.oauthHref,
                          i.oauthLabel ?? "Connect",
                          i.platform,
                          i.platform === "instagram" || i.platform === "whatsapp"
                            ? oauthConfigured.meta
                            : i.platform === "linkedin"
                              ? oauthConfigured.linkedin
                              : i.platform === "x"
                                ? oauthConfigured.x
                                : oauthConfigured.tiktok
                        )
                      ) : null}
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
              const platformConnected = p.platforms.some(
                (plat) => channelStatus[plat] ?? false
              );
              const anyPlatformConfigured = p.platforms.some((plat) => {
                if (plat === "instagram" || plat === "whatsapp") return oauthConfigured.meta;
                if (plat === "linkedin") return oauthConfigured.linkedin;
                if (plat === "x") return oauthConfigured.x;
                if (plat === "tiktok") return oauthConfigured.tiktok;
                return false;
              });
              return (
                <Card
                  key={p.id}
                  className={`group transition-all ${
                    platformConnected
                      ? "border-emerald-500/20 bg-emerald-500/5"
                      : "hover:border-accent/20"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-lg ${
                        platformConnected
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
                              channelStatus[plat]
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
                      {platformConnected ? (
                        <Badge tone="success" className="text-[10px]">
                          Active
                        </Badge>
                      ) : anyPlatformConfigured ? (
                        <Link
                          href={
                            p.platforms.includes("instagram") || p.platforms.includes("whatsapp")
                              ? "/api/oauth/meta/start?target=instagram"
                              : `/api/oauth/${p.platforms[0]}/start`
                          }
                        >
                          <Button size="sm" variant="outline" className="h-7 w-7 rounded-lg p-0">
                            <ArrowRight size={12} />
                          </Button>
                        </Link>
                      ) : (
                        <span className="text-[10px] text-ink-mute font-mono">No keys</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-rule/30">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-ink-mute">
                        {p.tone} · {p.expertise}
                      </span>
                      {platformConnected && (
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