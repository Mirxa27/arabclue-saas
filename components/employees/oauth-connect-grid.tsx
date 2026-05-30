"use client";

import { useEffect, useState } from "react";
import { Card, Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api/client";
import type { IntegrationKind, AIEmployeeIntegrationRow } from "@/lib/employees/types";
import type { LucideIcon } from "lucide-react";
import {
  Plug,
  Mail,
  Calendar as CalendarIcon,
  HardDrive,
  BarChart3,
  Target,
  Instagram,
  MessageCircle,
  Linkedin,
  MessageSquare,
  Hash,
  Twitter,
  Music2,
  Github,
  CreditCard,
  Receipt,
  FileSpreadsheet,
  Megaphone,
  HelpCircle,
  Loader2,
  Check
} from "lucide-react";

type Provider = {
  kind: IntegrationKind;
  label: string;
  brandColor: string;
  configured: boolean;
};

const ICONS: Partial<Record<IntegrationKind, LucideIcon>> = {
  gmail: Mail,
  gcal: CalendarIcon,
  google_drive: HardDrive,
  google_analytics: BarChart3,
  google_ads: Target,
  instagram: Instagram,
  whatsapp: MessageCircle,
  linkedin: Linkedin,
  slack: MessageSquare,
  hubspot: Hash,
  notion: Hash,
  x: Twitter,
  tiktok: Music2,
  github: Github,
  stripe: CreditCard,
  quickbooks: Receipt,
  xero: FileSpreadsheet,
  mailchimp: Megaphone,
  intercom: MessageSquare,
  zendesk: HelpCircle
};

export function OAuthConnectGrid({
  employeeId,
  integrations,
  onChange
}: {
  employeeId: string;
  integrations: AIEmployeeIntegrationRow[];
  onChange?: () => void;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<IntegrationKind | null>(null);

  useEffect(() => {
    apiFetch<{ providers: Provider[] }>("/api/employees/oauth/providers")
      .then((r) => setProviders(r.providers))
      .catch(() => setProviders([]))
      .finally(() => setLoading(false));
  }, []);

  function connect(kind: IntegrationKind) {
    setBusy(kind);
    const returnTo = encodeURIComponent(`/employees/${employeeId}?tab=integrations`);
    window.location.href = `/api/employees/${employeeId}/oauth/${kind}/start?return_to=${returnTo}`;
  }

  async function disconnect(kind: IntegrationKind) {
    setBusy(kind);
    try {
      await apiFetch(`/api/employees/${employeeId}/integrations?kind=${kind}`, { method: "DELETE" });
      onChange?.();
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <Card>
        <p className="text-sm text-ink-mute">Loading OAuth providers…</p>
      </Card>
    );
  }

  const configured = providers.filter((p) => p.configured);
  if (configured.length === 0) {
    return (
      <Card>
        <h3 className="font-display text-base text-ink flex items-center gap-2">
          <Plug size={14} className="text-ink-mute" /> One-click integrations
        </h3>
        <p className="mt-2 text-xs text-ink-mute">
          No OAuth providers are configured on this deployment yet. Ask your platform admin to set the relevant
          client id/secret env vars (Google, Meta, LinkedIn, Slack…) to enable one-click connect.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h3 className="font-display text-base text-ink flex items-center gap-2">
        <Plug size={14} className="text-accent" /> One-click integrations
      </h3>
      <p className="mt-1 text-xs text-ink-mute">
        Click to authorise — we'll exchange tokens, encrypt them, and attach to this employee.
      </p>
      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-2">
        {configured.map((p) => {
          const Icon = ICONS[p.kind] ?? Plug;
          const connected = integrations.find((i) => i.kind === p.kind);
          const isBusy = busy === p.kind;
          return (
            <div
              key={p.kind}
              className="relative flex flex-col items-start gap-2 px-3 py-3 rounded-xl border border-rule/30 bg-paper/40"
            >
              <div className="flex items-center gap-2 w-full">
                <span
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-paper"
                  style={{ background: p.brandColor }}
                >
                  <Icon size={14} className="text-paper" />
                </span>
                <p className="text-sm font-medium text-ink truncate flex-1">{p.label}</p>
                {connected && <Badge tone="success">on</Badge>}
              </div>
              {connected ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => disconnect(p.kind)}
                  disabled={isBusy}
                >
                  {isBusy ? <Loader2 size={12} className="animate-spin" /> : "Disconnect"}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full"
                  onClick={() => connect(p.kind)}
                  disabled={isBusy}
                >
                  {isBusy ? <Loader2 size={12} className="animate-spin" /> : <>Connect <Check size={12} /></>}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
