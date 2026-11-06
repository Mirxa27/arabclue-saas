"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardSubtitle, CardTitle, Field, Input, Badge } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";
import { ConnectionTestButton } from "@/components/admin/connection-test-button";
import type { AgentSettings, ConfigGroup, FeatureSettings } from "@/lib/admin/types";

type SettingsResponse = {
  settings: {
    agents: AgentSettings;
    features: FeatureSettings;
    updatedAt: string | null;
  };
  groups?: ConfigGroup[];
};

/** What each kill switch does when it is off (enforced server-side, SW-17). */
const FEATURE_FLAGS: ReadonlyArray<readonly [keyof FeatureSettings, string, string]> = [
  ["billing", "Moyasar billing", "Off: new plan and AI-employee checkouts answer 503. Payments already made still confirm."],
  ["zatca", "ZATCA invoicing", "Off: pauses ZATCA onboarding and Fatoora submissions (invoices are still generated)."],
  ["wathq", "Wathq enrichment", "Off: CR lookups answer 503 and spend no Wathq quota."],
  ["socialOAuth", "Social OAuth connect", "Off: merchants cannot connect new social accounts."]
];

function isConfigured(groups: ConfigGroup[] | undefined, key: string): boolean {
  return Boolean(groups?.some((g) => g.vars.some((v) => v.key === key && v.configured)));
}

export function AdminAgentsClient() {
  const { toast } = useToast();
  const [agents, setAgents] = useState<AgentSettings | null>(null);
  const [features, setFeatures] = useState<FeatureSettings | null>(null);
  const [humainConfigured, setHumainConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await apiFetch<SettingsResponse>("/api/admin/config");
        setAgents(res.settings.agents);
        setFeatures(res.settings.features);
        setHumainConfigured(isConfigured(res.groups, "HUMAIN_API_BASE"));
      } catch (err) {
        // Never fall back to defaults here: saving them would reset the kill switches.
        setLoadError(err instanceof ApiClientError ? err.message : "Failed to load agent settings");
      } finally {
        setLoading(false);
      }
    })();
  }, [attempt]);

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

  if (loadError) {
    return (
      <div className="p-4 md:p-8 pb-24 lg:pb-8 text-sm" role="alert">
        <p className="text-danger">Could not load the current agent settings: {loadError}</p>
        <p className="mt-1 text-ink-mute">Nothing was changed. Editing is disabled until the settings load.</p>
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </Button>
      </div>
    );
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
          <p className="text-xs text-ink-mute">
            Scheduler runs every 15 minutes (vercel.json on Vercel, scripts/hostinger-cron.sh on Hostinger).
          </p>
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
          <Field
            label="Model"
            hint="Used by POST /api/seo/generate. Global: an OpenAI model id (e.g. gpt-4o-mini) or a claude-… id (needs ANTHROPIC_API_KEY). KSA: a HUMAIN model id — OpenAI/Claude ids are not sent to HUMAIN and fall back to allam-b2b."
          >
            <Input
              value={agents.seo.model}
              onChange={(e) => setAgents({ ...agents, seo: { ...agents.seo, model: e.target.value } })}
            />
          </Field>
          <Field
            label="Data residency"
            hint="Where SEO prompts (product data, brand names, blog briefs) are processed. KSA routes them to HUMAIN for in-Kingdom inference."
          >
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
              <option value="global">Global (OpenAI / Anthropic)</option>
              <option value="ksa">KSA (HUMAIN)</option>
              {agents.seo.residency === "eu" && <option value="eu">EU — not available (SEO answers 503)</option>}
            </select>
          </Field>
          {agents.seo.residency === "ksa" && !humainConfigured && (
            <p className="text-xs text-danger" role="alert">
              HUMAIN_API_BASE is not set: SEO generation answers 503 until it is configured in /admin/config (AI providers).
            </p>
          )}
          {agents.seo.residency === "eu" && (
            <p className="text-xs text-danger" role="alert">
              There is no EU inference route: SEO generation is refused while EU is selected. Choose Global or KSA.
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Feature flags</CardTitle>
        </CardHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {FEATURE_FLAGS.map(([key, label, effect]) => (
            <label key={key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={features[key]}
                onChange={(e) => setFeatures({ ...features, [key]: e.target.checked })}
              />
              <span>
                {label}
                <span className="block text-[11px] text-ink-mute">{effect}</span>
              </span>
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
