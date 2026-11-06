import { getServiceSupabase } from "@/lib/db/supabase";
import { HttpError } from "@/lib/api/errors";
import { reportError } from "@/lib/observability/error-reporter";
import type { AgentSettings, FeatureSettings } from "@/lib/admin/types";

const DEFAULT_AGENTS: AgentSettings = {
  social: { enabled: true, maxPostsPerRun: 50 },
  voice: { enabled: true, defaultDialect: "khaliji" },
  seo: { enabled: true, model: "gpt-4o-mini", residency: "global" }
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const intIn = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

/**
 * Stored agent settings over the defaults, one agent and one field at a time. A stored
 * row may be partial or come from an older version (e.g. the retired social `cronMinutes`):
 * a shallow merge would leave a missing field undefined — `maxPostsPerRun` undefined
 * stops the scheduler from claiming anything — so every field is validated and falls back
 * to its default; unknown fields are dropped.
 */
export function normalizeAgentSettings(stored: unknown): AgentSettings {
  const s = isObj(stored) ? stored : {};
  const social = isObj(s.social) ? s.social : {};
  const voice = isObj(s.voice) ? s.voice : {};
  const seo = isObj(s.seo) ? s.seo : {};
  const d = DEFAULT_AGENTS;
  return {
    social: {
      enabled: bool(social.enabled, d.social.enabled),
      maxPostsPerRun: intIn(social.maxPostsPerRun, 1, 200, d.social.maxPostsPerRun)
    },
    voice: {
      enabled: bool(voice.enabled, d.voice.enabled),
      defaultDialect: oneOf(voice.defaultDialect, ["khaliji", "msa", "english"] as const, d.voice.defaultDialect)
    },
    seo: {
      enabled: bool(seo.enabled, d.seo.enabled),
      model: typeof seo.model === "string" && seo.model.trim() ? seo.model.trim() : d.seo.model,
      residency: oneOf(seo.residency, ["global", "ksa", "eu"] as const, d.seo.residency)
    }
  };
}

/** Stored feature flags over the defaults; anything but an explicit false keeps a feature on. */
export function normalizeFeatureSettings(stored: unknown): FeatureSettings {
  const s = isObj(stored) ? stored : {};
  return {
    billing: s.billing !== false,
    zatca: s.zatca !== false,
    wathq: s.wathq !== false,
    socialOAuth: s.socialOAuth !== false
  };
}

const DEFAULT_FEATURES: FeatureSettings = {
  billing: true,
  zatca: true,
  wathq: true,
  socialOAuth: true
};

export async function getPlatformSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const supabase = getServiceSupabase();
    const { data, error } = await supabase.from("platform_settings").select("value").eq("key", key).maybeSingle();
    if (error?.code === "42P01") return fallback;
    if (error) throw new Error(error.message);
    if (!data?.value) return fallback;
    return { ...fallback, ...(data.value as object) } as T;
  } catch (err) {
    // Runtime gates keep working on defaults during a transient outage, but the
    // failure is no longer silent.
    reportError(err, { extra: { platformSetting: key } });
    return fallback;
  }
}

export async function getAgentSettings(): Promise<AgentSettings> {
  return normalizeAgentSettings(await getPlatformSetting<unknown>("agents", DEFAULT_AGENTS));
}

export async function getFeatureSettings(): Promise<FeatureSettings> {
  return normalizeFeatureSettings(await getPlatformSetting<unknown>("features", DEFAULT_FEATURES));
}

/** An admin kill switch under /admin/agents → Feature flags. */
export type PlatformFeature = keyof FeatureSettings;

const FEATURE_OFF_MESSAGE: Record<PlatformFeature, { ar: string; en: string }> = {
  billing: {
    ar: "الدفع والاشتراكات متوقفة مؤقتاً من إدارة المنصة",
    en: "Billing is temporarily disabled by the platform admin"
  },
  zatca: {
    ar: "الفوترة الإلكترونية متوقفة مؤقتاً من إدارة المنصة",
    en: "ZATCA invoicing is temporarily disabled by the platform admin"
  },
  wathq: {
    ar: "خدمة واثق متوقفة مؤقتاً من إدارة المنصة",
    en: "Wathq enrichment is disabled by the platform admin"
  },
  socialOAuth: {
    ar: "ربط حسابات التواصل متوقف مؤقتاً من إدارة المنصة",
    en: "Social account connections are disabled by the platform admin"
  }
};

/** 503 for a request that needs a feature the platform admin switched off. */
export class PlatformFeatureDisabledError extends HttpError {
  readonly feature: PlatformFeature;
  constructor(feature: PlatformFeature) {
    const msg = FEATURE_OFF_MESSAGE[feature];
    super(503, `${msg.ar} · ${msg.en}`, `${feature}_disabled`);
    this.name = "PlatformFeatureDisabledError";
    this.feature = feature;
  }
}

export async function isPlatformFeatureEnabled(feature: PlatformFeature): Promise<boolean> {
  const features = await getFeatureSettings();
  return features[feature] !== false;
}

/**
 * Throws PlatformFeatureDisabledError (503, handled by handleRouteError) when the admin
 * switched `feature` off. A failed settings read keeps the defaults (on), as
 * getPlatformSetting documents, and is reported.
 */
export async function requirePlatformFeature(feature: PlatformFeature): Promise<void> {
  if (!(await isPlatformFeatureEnabled(feature))) throw new PlatformFeatureDisabledError(feature);
}

export async function updatePlatformSetting(key: string, value: Record<string, unknown>) {
  const supabase = getServiceSupabase();
  const { error } = await supabase.from("platform_settings").upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error?.code === "42P01") {
    throw new Error("platform_settings table missing — run migration 0005_platform_settings.sql");
  }
  if (error) throw new Error(error.message);
}

export type AllPlatformSettings = { agents: AgentSettings; features: FeatureSettings; updatedAt: string | null };

/**
 * Settings for the admin editor. Read errors propagate (only a missing table
 * falls back to defaults): showing all-enabled defaults after a failed read,
 * which the editor then saves back, would silently reset every kill switch.
 */
export async function getAllPlatformSettings(): Promise<AllPlatformSettings> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.from("platform_settings").select("key, value, updated_at");
  if (error?.code === "42P01") {
    return { agents: DEFAULT_AGENTS, features: DEFAULT_FEATURES, updatedAt: null };
  }
  if (error) throw new Error(`platform_settings read failed: ${error.message}`);
  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  return {
    agents: normalizeAgentSettings(map.agents),
    features: normalizeFeatureSettings(map.features),
    updatedAt: data?.find((r) => r.key === "agents")?.updated_at ?? null
  };
}
