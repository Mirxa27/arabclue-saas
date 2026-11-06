/**
 * Fixed Arabic + English names for the integrations the OAuth flows report on, and the
 * "connected" banner text built from them. A `?connected=<slug>` URL only selects one of these
 * labels — the slug itself is never rendered (content spoofing). Pure module, client-safe.
 */
import { isOAuthResultPlatform, type OAuthResultPlatform } from "@/lib/oauth/result";
import type { BilingualText } from "@/lib/salla/messages";

export const INTEGRATION_LABELS: Record<OAuthResultPlatform, BilingualText> = {
  salla: { ar: "سلة", en: "Salla" },
  instagram: { ar: "إنستغرام", en: "Instagram" },
  whatsapp: { ar: "واتساب للأعمال", en: "WhatsApp Business" },
  tiktok: { ar: "تيك توك", en: "TikTok" },
  linkedin: { ar: "لينكدإن", en: "LinkedIn" },
  x: { ar: "إكس (تويتر)", en: "X (Twitter)" },
  meta: { ar: "إنستغرام / واتساب", en: "Instagram / WhatsApp" }
};

/** Banner for `?connected=<slug>`: the platform's fixed label, or generic text for anything else. */
export function connectedBannerText(slug: string | null | undefined): BilingualText | null {
  if (!slug) return null;
  if (!isOAuthResultPlatform(slug)) return { ar: "تم الربط بنجاح.", en: "Connected successfully." };
  const label = INTEGRATION_LABELS[slug];
  return { ar: `تم ربط ${label.ar} بنجاح.`, en: `${label.en} connected successfully.` };
}
