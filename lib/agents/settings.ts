/**
 * arabclue — persona agent settings (public.agent_settings).
 *
 * Pure, client-safe logic shared by GET/PATCH /api/agents/status and the server store:
 * which persona roles exist, which plan feature each needs, how stored rows merge with
 * the persona defaults, and how a PATCH changes a row. No database access here.
 */
import { z } from "zod";
import type { ProductFeature } from "@/lib/billing/entitlements";
import { getPersona, type AgentPersona } from "@/lib/agents/personas";
import type { AgentStatus } from "@/lib/agents/store";

/** Persona agents a merchant can switch on (the onboarding guide is not a togglable agent). */
export const AGENT_ROLES = ["social", "voice", "seo", "sales", "support", "analyst"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_STATUSES = ["idle", "active", "paused", "error", "configuring"] as const satisfies readonly AgentStatus[];

/** Plan feature that must be included (and paid) before an agent can be switched on. */
export const AGENT_FEATURE: Record<AgentRole, ProductFeature> = {
  social: "social",
  voice: "voice",
  seo: "seo",
  sales: "employees",
  support: "employees",
  analyst: "employees"
};

export function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === "string" && (AGENT_ROLES as readonly string[]).includes(value);
}

export function featureForAgentRole(role: AgentRole): ProductFeature {
  return AGENT_FEATURE[role];
}

export const AgentOverridesSchema = z.object({
  display_name: z.string().trim().min(1).max(64).optional(),
  avatar: z.string().trim().min(1).max(64).optional(),
  tone: z.enum(["professional", "friendly", "formal", "playful"]).optional(),
  knowledge: z.string().max(2000).optional(),
  language: z.enum(["khaliji", "msa", "english"]).optional()
});
export type AgentOverrides = z.infer<typeof AgentOverridesSchema>;

export const AgentPatchSchema = z
  .object({
    role: z.enum(AGENT_ROLES),
    enabled: z.boolean().optional(),
    status: z.enum(AGENT_STATUSES).optional(),
    overrides: AgentOverridesSchema.optional()
  })
  .refine((p) => !(p.enabled === false && p.status === "active"), {
    message: "A disabled agent cannot be active",
    path: ["status"]
  });
export type AgentPatch = z.infer<typeof AgentPatchSchema>;

/** Row shape of public.agent_settings as selected by the store. */
export type AgentSettingRow = {
  persona_role: string;
  enabled: boolean;
  status: string;
  last_error: string | null;
  overrides: Record<string, unknown> | null;
  updated_at: string | null;
};
export const AGENT_SETTING_COLUMNS = "persona_role, enabled, status, last_error, overrides, updated_at";

export type AgentEntry = {
  role: AgentRole;
  enabled: boolean;
  status: AgentStatus;
  persona: {
    name: string;
    arabicName: string;
    age: number;
    role: string;
    avatar: string;
    tone: string;
    expertise: string[];
    traits: string[];
    backstory: string;
  };
  overrides: AgentOverrides | null;
  lastError: string | null;
  updatedAt: string | null;
};

function shapePersona(p: AgentPersona): AgentEntry["persona"] {
  return {
    name: p.nameEn,
    arabicName: p.name,
    age: p.age,
    role: p.role,
    avatar: p.avatar,
    tone: p.register,
    expertise: p.expertise,
    traits: p.traits,
    backstory: p.culturalContext
  };
}

/** Keep only well-formed override fields from a stored jsonb value. */
export function sanitizeOverrides(value: unknown): AgentOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: AgentOverrides = {};
  for (const [key, schema] of Object.entries(AgentOverridesSchema.shape)) {
    const parsed = schema.safeParse((value as Record<string, unknown>)[key]);
    if (parsed.success && parsed.data !== undefined) (out as Record<string, unknown>)[key] = parsed.data;
  }
  return out;
}

function toStatus(value: unknown): AgentStatus {
  return (AGENT_STATUSES as readonly string[]).includes(value as string) ? (value as AgentStatus) : "idle";
}

export function buildAgentEntry(role: AgentRole, row: AgentSettingRow | null | undefined): AgentEntry {
  const shaped = shapePersona(getPersona(role));
  const overrides = row ? sanitizeOverrides(row.overrides) : null;
  return {
    role,
    enabled: row?.enabled ?? false,
    status: row ? toStatus(row.status) : "idle",
    persona: {
      ...shaped,
      name: overrides?.display_name ?? shaped.name,
      avatar: overrides?.avatar ?? shaped.avatar,
      tone: overrides?.tone ?? shaped.tone
    },
    overrides,
    lastError: row?.last_error ?? null,
    updatedAt: row?.updated_at ?? null
  };
}

/**
 * One entry per persona role, defaults filled in for roles without a row. Rows whose
 * role has no persona are skipped instead of crashing the whole response.
 */
export function buildAgentEntries(rows: readonly AgentSettingRow[]): AgentEntry[] {
  const byRole = new Map<AgentRole, AgentSettingRow>();
  for (const row of rows) {
    if (isAgentRole(row.persona_role)) byRole.set(row.persona_role, row);
  }
  return AGENT_ROLES.map((role) => buildAgentEntry(role, byRole.get(role)));
}

/** True when the patch switches the agent on (the plan must include its feature). */
export function patchActivatesAgent(patch: AgentPatch): boolean {
  return patch.enabled === true || patch.status === "active";
}

/** Column values to store after applying `patch` to the current row (if any). */
export function nextAgentSetting(
  existing: AgentSettingRow | null | undefined,
  patch: AgentPatch
): { enabled: boolean; status: AgentStatus; last_error: string | null; overrides: AgentOverrides } {
  const enabled = patch.enabled ?? existing?.enabled ?? false;
  let status: AgentStatus;
  if (patch.status) status = patch.status;
  else if (patch.enabled !== undefined) status = patch.enabled ? "active" : "idle";
  else status = existing ? toStatus(existing.status) : "idle";
  if (!enabled && status === "active") status = "idle";

  const touchedState = patch.enabled !== undefined || patch.status !== undefined;
  const last_error = status === "error" || !touchedState ? existing?.last_error ?? null : null;

  return {
    enabled,
    status,
    last_error,
    overrides: { ...sanitizeOverrides(existing?.overrides), ...(patch.overrides ?? {}) }
  };
}
