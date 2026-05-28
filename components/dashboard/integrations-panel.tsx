"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardSubtitle, CardTitle, Badge, Field, Input } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";

type IntegrationCard = {
  name: string;
  platform?: "instagram" | "tiktok" | "x" | "linkedin" | "whatsapp";
  desc: string;
  connected: boolean;
  action: React.ReactNode;
};

type Props = {
  sallaInstallURL: string;
  sallaConnected: boolean;
  channelStatus: Record<string, boolean>;
};

export function IntegrationsPanel({ sallaInstallURL, sallaConnected, channelStatus }: Props) {
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);
  const [connectPlatform, setConnectPlatform] = useState<IntegrationCard["platform"]>("instagram");
  const [externalId, setExternalId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [connecting, setConnecting] = useState(false);

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

  async function connectSocial() {
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
      window.location.reload();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Connect failed", "error");
    } finally {
      setConnecting(false);
    }
  }

  const integrations: IntegrationCard[] = [
    {
      name: "Salla",
      desc: "OAuth into your Salla store to enable ZATCA invoicing and product sync.",
      connected: sallaConnected,
      action: (
        <div className="flex flex-wrap gap-2">
          {!sallaConnected && (
            <Link href={sallaInstallURL}>
              <Button>Connect Salla</Button>
            </Link>
          )}
          {sallaConnected && (
            <Button variant="ghost" type="button" onClick={syncProducts} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync products"}
            </Button>
          )}
        </div>
      )
    },
    {
      name: "Instagram & Facebook (Meta)",
      platform: "instagram",
      desc: "Store IG Business user ID + page access token for publishing.",
      connected: channelStatus.instagram ?? false,
      action: null
    },
    {
      name: "TikTok",
      platform: "tiktok",
      desc: "Post videos via TikTok Content Posting API.",
      connected: channelStatus.tiktok ?? false,
      action: null
    },
    {
      name: "LinkedIn",
      platform: "linkedin",
      desc: "Post to your company page via LinkedIn API v2.",
      connected: channelStatus.linkedin ?? false,
      action: null
    },
    {
      name: "X (Twitter)",
      platform: "x",
      desc: "Post to your X account via API v2 bearer token.",
      connected: channelStatus.x ?? false,
      action: null
    },
    {
      name: "WhatsApp Business",
      platform: "whatsapp",
      desc: "Broadcast via approved templates only — no spam.",
      connected: channelStatus.whatsapp ?? false,
      action: null
    }
  ];

  return (
    <div className="p-8 grid md:grid-cols-2 gap-4 overflow-y-auto">
      {integrations.map((i) => (
        <Card key={i.name}>
          <CardHeader>
            <div>
              <CardTitle>{i.name}</CardTitle>
              <CardSubtitle className="mt-1">{i.desc}</CardSubtitle>
            </div>
            <Badge tone={i.connected ? "success" : "default"}>{i.connected ? "Connected" : "Not connected"}</Badge>
          </CardHeader>
          <div>{i.action}</div>
        </Card>
      ))}

      <Card className="md:col-span-2">
        <CardHeader>
          <div>
            <CardTitle>Connect a social channel</CardTitle>
            <CardSubtitle>Paste platform credentials from your Meta / TikTok / LinkedIn / X / WhatsApp developer console.</CardSubtitle>
          </div>
        </CardHeader>
        <div className="grid md:grid-cols-3 gap-4">
          <Field label="Platform">
            <select
              className="w-full bg-paper border border-ink/15 px-3 py-2.5 text-sm"
              value={connectPlatform}
              onChange={(e) => setConnectPlatform(e.target.value as IntegrationCard["platform"])}
            >
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="linkedin">LinkedIn</option>
              <option value="x">X</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </Field>
          <Field label="External ID" hint="IG user ID, LinkedIn actor URN, or WhatsApp phone ID">
            <Input value={externalId} onChange={(e) => setExternalId(e.target.value)} />
          </Field>
          <Field label="Access token">
            <Input value={accessToken} onChange={(e) => setAccessToken(e.target.value)} type="password" />
          </Field>
        </div>
        <Button className="mt-4" onClick={connectSocial} disabled={connecting}>
          {connecting ? "Connecting…" : "Save channel credentials"}
        </Button>
      </Card>
    </div>
  );
}
