import { getServiceSupabase } from "@/lib/db/supabase";
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
  } catch {
    return fallback;
  }
}

export async function getAgentSettings(): Promise<AgentSettings> {
  return getPlatformSetting("agents", DEFAULT_AGENTS);
}

export async function getFeatureSettings(): Promise<FeatureSettings> {
  return getPlatformSetting("features", DEFAULT_FEATURES);
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

export async function getAllPlatformSettings() {
  try {
    const supabase = getServiceSupabase();
    const { data, error } = await supabase.from("platform_settings").select("key, value, updated_at");
    if (error?.code === "42P01") {
      return { agents: DEFAULT_AGENTS, features: DEFAULT_FEATURES, updatedAt: null };
    }
    if (error) throw new Error(error.message);
    const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    return {
      agents: { ...DEFAULT_AGENTS, ...(map.agents as object) } as AgentSettings,
      features: { ...DEFAULT_FEATURES, ...(map.features as object) } as FeatureSettings,
      updatedAt: data?.find((r) => r.key === "agents")?.updated_at ?? null
    };
  } catch {
    return { agents: DEFAULT_AGENTS, features: DEFAULT_FEATURES, updatedAt: null };
  }
}
