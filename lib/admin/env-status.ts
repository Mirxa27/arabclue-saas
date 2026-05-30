import type { ConfigGroup, EnvVarStatus } from "@/lib/admin/types";
import { SECRET_GROUPS, type SecretFieldDef } from "@/lib/admin/secret-registry";
import { getPlatformEnv } from "@/lib/platform/env";

function mask(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function fieldStatus(field: SecretFieldDef): EnvVarStatus {
  const raw = getPlatformEnv(field.key);
  const configured = Boolean(raw?.trim());
  return {
    key: field.key,
    label: field.label,
    configured,
    preview: configured ? mask(raw) : undefined,
    required: field.required,
    bootstrap: field.bootstrap,
    editable: !field.bootstrap,
    hint: field.hint,
    inputType: field.type
  };
}

export function getPlatformConfigGroups(): ConfigGroup[] {
  return SECRET_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    description: group.description,
    vars: group.fields.map(fieldStatus)
  }));
}

export function configHealthSummary(groups: ConfigGroup[]) {
  const all = groups.flatMap((g) => g.vars);
  const required = all.filter((v) => v.required);
  const configuredRequired = required.filter((v) => v.configured).length;
  return {
    total: all.length,
    configured: all.filter((v) => v.configured).length,
    requiredTotal: required.length,
    requiredConfigured: configuredRequired,
    ready: configuredRequired === required.length
  };
}
