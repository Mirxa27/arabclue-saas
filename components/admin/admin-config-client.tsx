"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardSubtitle, CardTitle, Badge, Field, Input } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { useToast } from "@/components/ui/toast";
import { ConnectionTestButton, TestAllConnectionsButton } from "@/components/admin/connection-test-button";
import { ConnectionTestHistory } from "@/components/admin/connection-test-history";
import type { ConfigGroup, EnvVarStatus, TestableService } from "@/lib/admin/types";

type ConfigResponse = {
  groups: ConfigGroup[];
  health: {
    total: number;
    configured: number;
    requiredTotal: number;
    requiredConfigured: number;
    ready: boolean;
  };
};

const GROUP_TESTS: Record<string, TestableService[]> = {
  core: ["supabase", "oauth", "cron"],
  ai: ["openai", "anthropic", "social_engager"],
  salla: ["salla"],
  meta: ["meta"],
  social_oauth: ["linkedin", "x", "tiktok"],
  billing: ["moyasar"],
  zatca: ["zatca"],
  voice: ["openai"],
  wathq: ["wathq"]
};

function SecretFieldRow({
  field,
  draft,
  onDraftChange
}: {
  field: EnvVarStatus;
  draft: string;
  onDraftChange: (value: string) => void;
}) {
  const readOnly = field.bootstrap || field.editable === false;

  return (
    <li className="py-4 border-b border-rule/40 last:border-0 space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-xs text-ink-mute">{field.key}</p>
          <p className="text-sm text-ink-soft">{field.label}</p>
          {field.hint && <p className="text-xs text-ink-mute mt-1">{field.hint}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {field.preview && <span className="text-xs text-ink-mute font-mono">{field.preview}</span>}
          <Badge tone={field.configured ? "success" : field.required ? "danger" : "default"}>
            {field.configured ? "Set" : field.required ? "Missing" : "Optional"}
          </Badge>
          {field.bootstrap && (
            <Badge tone="default" className="text-[9px]">
              hPanel
            </Badge>
          )}
        </div>
      </div>
      {!readOnly && (
        <Field
          label={field.configured ? "New value (leave blank to keep)" : "Value"}
          hint='Clear stored value with checkbox below'
        >
          <Input
            type={field.inputType === "secret" ? "password" : "text"}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder={field.configured ? "••••••••" : "Enter value…"}
            autoComplete="off"
          />
        </Field>
      )}
    </li>
  );
}

function SecretGroupCard({
  group,
  tests,
  onSaved
}: {
  group: ConfigGroup;
  tests: TestableService[];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [clears, setClears] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(!group.vars.every((v) => v.configured || !v.required));

  const editableVars = group.vars.filter((v) => v.editable !== false && !v.bootstrap);

  async function saveGroup() {
    const secrets: Record<string, string | null> = {};
    for (const v of editableVars) {
      if (clears[v.key]) {
        secrets[v.key] = null;
        continue;
      }
      const draft = drafts[v.key]?.trim();
      if (draft) secrets[v.key] = draft;
    }
    if (Object.keys(secrets).length === 0) {
      toast("No changes to save", "error");
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch<{
        ok: boolean;
        secrets?: { updated: string[]; skipped: string[] };
      }>("/api/admin/config", {
        method: "PATCH",
        body: JSON.stringify({ secrets })
      });
      const n = res.secrets?.updated.length ?? 0;
      toast(n ? `Saved ${n} setting(s) for ${group.title}` : "Nothing updated", n ? "success" : "error");
      setDrafts({});
      setClears({});
      onSaved();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{group.title}</CardTitle>
          <CardSubtitle>{group.description}</CardSubtitle>
        </div>
        <div className="flex flex-wrap gap-2 justify-end items-center">
          {tests.map((svc) => (
            <ConnectionTestButton key={svc} service={svc} />
          ))}
          {editableVars.length > 0 && (
            <Button variant="ghost" type="button" onClick={() => setExpanded((e) => !e)}>
              {expanded ? "Collapse" : "Edit"}
            </Button>
          )}
        </div>
      </CardHeader>
      <ul className="text-sm">
        {group.vars.map((v) => (
          <div key={v.key}>
            <SecretFieldRow
              field={v}
              draft={drafts[v.key] ?? ""}
              onDraftChange={(value) => setDrafts((d) => ({ ...d, [v.key]: value }))}
            />
            {expanded && v.editable !== false && !v.bootstrap && v.configured && (
              <label className="flex items-center gap-2 text-xs text-ink-mute px-0 pb-3 -mt-2">
                <input
                  type="checkbox"
                  checked={clears[v.key] ?? false}
                  onChange={(e) => setClears((c) => ({ ...c, [v.key]: e.target.checked }))}
                />
                Remove stored value for {v.key}
              </label>
            )}
          </div>
        ))}
      </ul>
      {expanded && editableVars.length > 0 && (
        <div className="pt-2 pb-4 px-1">
          <Button type="button" onClick={saveGroup} disabled={saving}>
            {saving ? "Saving…" : `Save ${group.title}`}
          </Button>
        </div>
      )}
    </Card>
  );
}

export function AdminConfigClient() {
  const { toast } = useToast();
  const [data, setData] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<ConfigResponse>("/api/admin/config");
      setData(res);
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Failed to load config", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="p-4 md:p-8 pb-24 lg:pb-8 text-sm text-ink-mute">Loading configuration…</p>;
  if (!data) return null;

  return (
    <div className="p-4 md:p-8 pb-24 lg:pb-8 space-y-6 overflow-y-auto max-w-4xl">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Platform configuration</CardTitle>
            <CardSubtitle>
              Manage integrations, API keys, and agent settings from here. Secrets are encrypted in Supabase
              (requires TOKEN_ENCRYPTION_KEY in hPanel). Bootstrap Supabase keys stay in hPanel only.
            </CardSubtitle>
          </div>
          <div className="flex items-center gap-3 flex-wrap justify-end">
            <Badge tone={data.health.ready ? "success" : "warn"}>
              {data.health.ready ? "Production ready" : "Incomplete"}
            </Badge>
            <Badge tone="default">
              {data.health.configured}/{data.health.total} set
            </Badge>
            <TestAllConnectionsButton />
          </div>
        </CardHeader>
        <p className="text-xs text-ink-mute px-1 pb-2">
          Required: {data.health.requiredConfigured}/{data.health.requiredTotal} · Agent toggles live under{" "}
          <a href="/admin/agents" className="text-accent hover:underline">
            Agents
          </a>
        </p>
      </Card>

      {data.groups.map((group) => (
        <SecretGroupCard
          key={group.id}
          group={group}
          tests={GROUP_TESTS[group.id] ?? []}
          onSaved={() => {
            setLoading(true);
            void load();
          }}
        />
      ))}

      <ConnectionTestHistory />
    </div>
  );
}
