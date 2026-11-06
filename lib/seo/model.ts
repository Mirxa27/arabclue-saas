/**
 * Which model and data-residency the SEO agent runs on (SW-43): the admin's
 * /admin/agents → SEO agent "Model" and "Data residency" settings (platform_settings.agents.seo),
 * turned into aiStructured options — or an honest 503 when the choice cannot be honoured.
 *
 *   global  → the configured model (an OpenAI id, or a claude-* id on Anthropic); blank → the
 *             provider default (gpt-4o-mini). Needs the matching API key.
 *   ksa     → HUMAIN (in-Kingdom inference, lib/ai/providers.ts). Needs HUMAIN_API_BASE.
 *             OpenAI / Anthropic model ids are not sent to HUMAIN (the seeded default is
 *             gpt-4o-mini): those fall back to HUMAIN's default model (allam-b2b).
 *   eu      → no EU route exists: refused instead of silently running on the global endpoint.
 */
import { HttpError } from "@/lib/api/errors";
import type { Residency } from "@/lib/ai/providers";
import type { AgentSettings } from "@/lib/admin/types";

export type SeoModelChoice = { model?: string; residency: Residency };

/** Model ids that belong to the global providers, never to HUMAIN. */
const GLOBAL_MODEL_ID = /^(gpt-|chatgpt-|o\d|text-|davinci|claude)/i;

function seoUnavailable(code: string, ar: string, en: string): HttpError {
  return new HttpError(503, `${ar} · ${en}`, code);
}

export function resolveSeoModel(
  settings: AgentSettings["seo"],
  env: Record<string, string | undefined> = process.env
): SeoModelChoice {
  const model = settings.model?.trim() || undefined;
  const has = (key: string) => Boolean(env[key]?.trim());

  switch (settings.residency) {
    case "ksa": {
      if (!has("HUMAIN_API_BASE")) {
        throw seoUnavailable(
          "seo_residency_unavailable",
          "توليد محتوى السيو متوقف: إعداد الاستضافة داخل المملكة (HUMAIN) غير مكتمل",
          "SEO generation is unavailable: in-Kingdom (HUMAIN) inference is selected but HUMAIN_API_BASE is not configured"
        );
      }
      return { residency: "ksa", model: model && !GLOBAL_MODEL_ID.test(model) ? model : undefined };
    }
    case "global": {
      const anthropic = Boolean(model?.toLowerCase().startsWith("claude"));
      if (!has(anthropic ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY")) {
        throw seoUnavailable(
          "ai_not_configured",
          "توليد محتوى السيو غير مفعّل على المنصة حالياً",
          "AI generation is not configured on this platform"
        );
      }
      return { residency: "global", model };
    }
    default:
      throw seoUnavailable(
        "seo_residency_unsupported",
        "توليد محتوى السيو متوقف: منطقة الاستضافة المختارة غير متاحة",
        "SEO generation is unavailable: the selected data residency has no provider — choose Global or KSA in /admin/agents"
      );
  }
}
