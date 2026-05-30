export type ConnectionTestResult = {
  ok: boolean;
  message: string;
  latencyMs?: number;
  detail?: string;
};

export type EnvVarStatus = {
  key: string;
  label: string;
  configured: boolean;
  preview?: string;
  required: boolean;
  /** Set only via hPanel — cannot save from admin UI */
  bootstrap?: boolean;
  /** Can be updated from /admin/config */
  editable?: boolean;
  hint?: string;
  inputType?: "secret" | "text" | "url" | "emails";
};

export type ConfigGroup = {
  id: string;
  title: string;
  description: string;
  vars: EnvVarStatus[];
};

export type AgentSettings = {
  social: { enabled: boolean; cronMinutes: number; maxPostsPerRun: number };
  voice: { enabled: boolean; defaultDialect: "khaliji" | "msa" | "english" };
  seo: { enabled: boolean; model: string; residency: "global" | "ksa" | "eu" };
};

export type FeatureSettings = {
  billing: boolean;
  zatca: boolean;
  wathq: boolean;
  socialOAuth: boolean;
};

export const TESTABLE_SERVICES = [
  "supabase",
  "openai",
  "anthropic",
  "salla",
  "meta",
  "linkedin",
  "x",
  "tiktok",
  "moyasar",
  "wathq",
  "zatca",
  "cron",
  "oauth",
  "social_engager"
] as const;

export type TestableService = (typeof TESTABLE_SERVICES)[number];
