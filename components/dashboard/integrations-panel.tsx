"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardSubtitle, CardTitle, Badge, Field, Input } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";

type SocialPlatform = "instagram" | "tiktok" | "x" | "linkedin" | "whatsapp";

type IntegrationCard = {
  name: string;
  platform?: SocialPlatform;
  desc: string;
  connected: boolean;
  oauthHref?: string;
  oauthLabel?: string;
};

type Props = {
  sallaInstallURL: string;
  sallaConnected: boolean;
  channelStatus: Record<string, boolean>;
  oauthConfigured: {
    meta: boolean;
    linkedin: boolean;
    x: boolean;
    tiktok: boolean;
  };
  socialOAuthEnabled?: boolean;
};

export function IntegrationsPanel({
  sallaInstallURL,
  sallaConnected,
  channelStatus,
  oauthConfigured,
  socialOAuthEnabled = true
}: Props) {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const [syncing, setSyncing] = useState(false);
  const [connectPlatform, setConnectPlatform] = useState<SocialPlatform>("instagram");
  const [externalId, setExternalId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const connectedParam = searchParams.get("connected");
  const oauthError = searchParams.get("oauth") === "error";

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
        body: JSON.stringify({ platform: connectPlatform, externalId, accessToken })
      });
      toast(`${connectPlatform} connected`, "success");
      window.location.href = "/integrations";
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Connect failed", "error");
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect(platform: SocialPlatform) {
    setDisconnecting(platform);
    try {
      await apiFetch("/api/integrations/social/disconnect", {
        method: "POST",
        body: JSON.stringify({ platform })
      });
      toast(`${platform} disconnected`, "success");
      window.location.href = "/integrations";
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Disconnect failed", "error");
    } finally {
      setDisconnecting(null);
    }
  }

  function oauthAction(href: string | undefined, label: string, platform: SocialPlatform, configured: boolean) {
    if (channelStatus[platform]) {
      return (
        <Button
          variant="ghost"
          type="button"
          disabled={disconnecting === platform}
          onClick={() => disconnect(platform)}
        >
          {disconnecting === platform ? "Disconnecting…" : "Disconnect"}
        </Button>
      );
    }
    if (!configured || !href) {
      return (
        <span className="text-xs text-ink/50">
          {!socialOAuthEnabled ? "Social OAuth disabled by platform admin" : "Add API keys in server env to enable OAuth"}
        </span>
      );
    }
    return (
      <Link href={href}>
        <Button type="button">{label}</Button>
      </Link>
    );
  }

  const integrations: IntegrationCard[] = [
    {
      name: "Salla",
      desc: "OAuth into your Salla store to enable ZATCA invoicing and product sync.",
      connected: sallaConnected,
      oauthHref: sallaInstallURL,
      oauthLabel: "Connect Salla"
    },
    {
      name: "Instagram",
      platform: "instagram",
      desc: "Publish posts and hand off DMs/comments to the engager agent via Meta webhooks.",
      connected: channelStatus.instagram ?? false,
      oauthHref: oauthConfigured.meta ? "/api/oauth/meta/start?target=instagram" : undefined,
      oauthLabel: "Connect Instagram"
    },
    {
      name: "WhatsApp Business",
      platform: "whatsapp",
      desc: "Inbound WhatsApp messages route to the engager; escalations notify your ops desk.",
      connected: channelStatus.whatsapp ?? false,
      oauthHref: oauthConfigured.meta ? "/api/oauth/meta/start?target=whatsapp" : undefined,
      oauthLabel: "Connect WhatsApp"
    },
    {
      name: "TikTok",
      platform: "tiktok",
      desc: "OAuth + Content Posting API for scheduled video captions.",
      connected: channelStatus.tiktok ?? false,
      oauthHref: oauthConfigured.tiktok ? "/api/oauth/tiktok/start" : undefined,
      oauthLabel: "Connect TikTok"
    },
    {
      name: "LinkedIn",
      platform: "linkedin",
      desc: "Post to your company page; inbound handled via bridge API.",
      connected: channelStatus.linkedin ?? false,
      oauthHref: oauthConfigured.linkedin ? "/api/oauth/linkedin/start" : undefined,
      oauthLabel: "Connect LinkedIn"
    },
    {
      name: "X (Twitter)",
      platform: "x",
      desc: "OAuth 2.0 user context for posting and agent handover.",
      connected: channelStatus.x ?? false,
      oauthHref: oauthConfigured.x ? "/api/oauth/x/start" : undefined,
      oauthLabel: "Connect X"
    }
  ];

  return (
    <div className="p-4 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 overflow-y-auto pb-24 md:pb-8">
      {(connectedParam || oauthError) && (
        <div className="md:col-span-2 text-sm border border-ink/15 px-4 py-3 bg-paper">
          {oauthError && <span className="text-red-700">OAuth connection failed. Check app credentials and try again.</span>}
          {connectedParam && !oauthError && (
            <span className="text-emerald-800">{connectedParam} connected successfully.</span>
          )}
        </div>
      )}

      {integrations.map((i) => (
        <Card key={i.name}>
          <CardHeader>
            <div>
              <CardTitle>{i.name}</CardTitle>
              <CardSubtitle className="mt-1">{i.desc}</CardSubtitle>
            </div>
            <Badge tone={i.connected ? "success" : "default"}>{i.connected ? "Connected" : "Not connected"}</Badge>
          </CardHeader>
          <div className="flex flex-wrap gap-2">
            {i.name === "Salla" ? (
              <>
                {!sallaConnected && i.oauthHref && (
                  <Link href={i.oauthHref}>
                    <Button>{i.oauthLabel}</Button>
                  </Link>
                )}
                {sallaConnected && (
                  <Button variant="ghost" type="button" onClick={syncProducts} disabled={syncing}>
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
        </Card>
      ))}

      <Card className="md:col-span-2">
        <CardHeader>
          <div>
            <CardTitle>Advanced: manual token override</CardTitle>
            <CardSubtitle>
              Use OAuth above when possible. Paste developer-console tokens only for sandbox or legacy apps.
            </CardSubtitle>
          </div>
        </CardHeader>
        <div className="grid md:grid-cols-3 gap-4">
          <Field label="Platform">
            <select
              className="w-full bg-paper border border-ink/15 px-3 py-2.5 text-sm"
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
            <Input value={accessToken} onChange={(e) => setAccessToken(e.target.value)} type="password" />
          </Field>
        </div>
        <Button className="mt-4" onClick={connectSocialManual} disabled={connecting}>
          {connecting ? "Connecting…" : "Save channel credentials"}
        </Button>
      </Card>
    </div>
  );
}
