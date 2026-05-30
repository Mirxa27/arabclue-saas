"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardSubtitle, CardTitle, Field, Input, Badge } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";
import { ConnectionTestButton } from "@/components/admin/connection-test-button";
import type { AgentSettings, FeatureSettings } from "@/lib/admin/types";

type SettingsResponse = {
  settings: {
    agents: AgentSettings;
    features: FeatureSettings;
    updatedAt: string | null;
  };
};

export function AdminAgentsClient() {
  const { toast } = useToast();
  const [agents, setAgents] = useState<AgentSettings | null>(null);
  const [features, setFeatures] = useState<FeatureSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch<SettingsResponse>("/api/admin/config");
        setAgents(res.settings.agents);
        setFeatures(res.settings.features);
      } catch (err) {
        toast(err instanceof ApiClientError ? err.message : "Failed to load agents", "error");
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  async function save() {
    if (!agents || !features) return;
    setSaving(true);
    try {
      await apiFetch("/api/admin/config", {
        method: "PATCH",
        body: JSON.stringify({ agents, features })
      });
      toast("Agent settings saved", "success");
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !agents || !features) {
    return <p className="p-4 md:p-8 pb-24 lg:pb-8 text-sm text-ink-mute">Loading agent configuration…</p>;
  }

  return (
    <div className="p-4 md:p-8 pb-24 lg:pb-8 space-y-6 overflow-y-auto max-w-3xl">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Social agent</CardTitle>
            <CardSubtitle>Planner, copywriter, visualist, scheduler, engager pipeline.</CardSubtitle>
          </div>
          <ConnectionTestButton service="social_engager" />
        </CardHeader>
        <div className="grid gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={agents.social.enabled}
              onChange={(e) => setAgents({ ...agents, social: { ...agents.social, enabled: e.target.checked } })}
            />
            Enabled
          </label>
          <Field label="Cron interval (minutes)" hint="Hostinger hPanel cron should match this">
            <Input
              type="number"
              min={5}
              max={1440}
              value={agents.social.cronMinutes}
              onChange={(e) =>
                setAgents({
                  ...agents,
                  social: { ...agents.social, cronMinutes: Number(e.target.value) || 15 }
                })
              }
            />
          </Field>
          <Field label="Max posts per cron run">
            <Input
              type="number"
              min={1}
              max={200}
              value={agents.social.maxPostsPerRun}
              onChange={(e) =>
                setAgents({
                  ...agents,
                  social: { ...agents.social, maxPostsPerRun: Number(e.target.value) || 50 }
                })
              }
            />
          </Field>
          <ConnectionTestButton service="cron" />
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Voice agent</CardTitle>
            <CardSubtitle>Realtime telephony + tool dispatch to Salla/bookings.</CardSubtitle>
          </div>
          <ConnectionTestButton service="openai" />
        </CardHeader>
        <div className="grid gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={agents.voice.enabled}
              onChange={(e) => setAgents({ ...agents, voice: { ...agents.voice, enabled: e.target.checked } })}
            />
            Enabled
          </label>
          <Field label="Default dialect">
            <select
              className="w-full bg-paper border border-ink/15 px-3 py-2.5 text-sm"
              value={agents.voice.defaultDialect}
              onChange={(e) =>
                setAgents({
                  ...agents,
                  voice: {
                    ...agents.voice,
                    defaultDialect: e.target.value as AgentSettings["voice"]["defaultDialect"]
                  }
                })
              }
            >
              <option value="khaliji">Khaliji</option>
              <option value="msa">MSA</option>
              <option value="english">English</option>
            </select>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>SEO agent</CardTitle>
            <CardSubtitle>Arabic SEO copy generation for product pages.</CardSubtitle>
          </div>
          <ConnectionTestButton service="openai" />
        </CardHeader>
        <div className="grid gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={agents.seo.enabled}
              onChange={(e) => setAgents({ ...agents, seo: { ...agents.seo, enabled: e.target.checked } })}
            />
            Enabled
          </label>
          <Field label="Model">
            <Input
              value={agents.seo.model}
              onChange={(e) => setAgents({ ...agents, seo: { ...agents.seo, model: e.target.value } })}
            />
          </Field>
          <Field label="Data residency">
            <select
              className="w-full bg-paper border border-ink/15 px-3 py-2.5 text-sm"
              value={agents.seo.residency}
              onChange={(e) =>
                setAgents({
                  ...agents,
                  seo: { ...agents.seo, residency: e.target.value as AgentSettings["seo"]["residency"] }
                })
              }
            >
              <option value="global">Global</option>
              <option value="ksa">KSA (HUMAIN)</option>
              <option value="eu">EU</option>
            </select>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Feature flags</CardTitle>
        </CardHeader>
        <div className="flex flex-wrap gap-4">
          {(
            [
              ["billing", "Moyasar billing"],
              ["zatca", "ZATCA invoicing"],
              ["wathq", "Wathq enrichment"],
              ["socialOAuth", "Social OAuth connect"]
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={features[key]}
                onChange={(e) => setFeatures({ ...features, [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save agent settings"}
        </Button>
        {!features.socialOAuth && (
          <Badge tone="warn">Social OAuth disabled for merchants</Badge>
        )}
      </div>
    </div>
  );
}
