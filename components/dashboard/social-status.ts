/** Bilingual labels and badge tones for social post statuses (page + drawer). */
import type { BilingualText } from "@/lib/social/outcomes";
import type { SocialPostStatus } from "@/lib/types/database";

export const SOCIAL_STATUS_TEXT: Record<SocialPostStatus, BilingualText> = {
  draft: { ar: "مسودة", en: "Draft" },
  scheduled: { ar: "مجدول", en: "Scheduled" },
  publishing: { ar: "يُنشر الآن", en: "Publishing" },
  published: { ar: "منشور", en: "Published" },
  failed: { ar: "لم يُنشر", en: "Failed" },
  canceled: { ar: "ملغى", en: "Canceled" }
};

export type SocialBadgeTone = "default" | "success" | "warn" | "danger" | "info" | "accent";

export function socialStatusTone(status: string): SocialBadgeTone {
  switch (status) {
    case "published":
      return "success";
    case "failed":
      return "danger";
    case "scheduled":
      return "warn";
    case "draft":
      return "info";
    default:
      return "default";
  }
}
