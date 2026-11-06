import { getServiceSupabase } from "@/lib/db/supabase";
import { HttpError } from "@/lib/api/errors";
import { reportError } from "@/lib/observability/error-reporter";
import type { AgentSettings, FeatureSettings } from "@/lib/admin/types";

const DEFAULT_AGENTS: AgentSettings = {
  social: { enabled: true, cronMinutes: 15, maxPostsPerRun: 50 },
  voice: { enabled: true, defaultDialect: "khaliji" },
  seo: { enabled: true, model: "gpt-4o-mini", residency: "global" }
};

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
  return getPlatformSetting("agents", DEFAULT_AGENTS);
}

export async function getFeatureSettings(): Promise<FeatureSettings> {
  return getPlatformSetting("features", DEFAULT_FEATURES);
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
    agents: { ...DEFAULT_AGENTS, ...(map.agents as object) } as AgentSettings,
    features: { ...DEFAULT_FEATURES, ...(map.features as object) } as FeatureSettings,
    updatedAt: data?.find((r) => r.key === "agents")?.updated_at ?? null
  };
}
