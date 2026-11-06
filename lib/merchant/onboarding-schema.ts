/**
 * Request contract for POST /api/merchant/onboarding (the /welcome wizard).
 * Client-safe: no server imports, so the page can share the helpers.
 *
 * The body is strict: plan, subscription, billing, Salla or ZATCA fields are rejected,
 * never silently stored. The plan a merchant picks in the wizard is only a checkout
 * intent (/billing?plan=…) — it is applied when Moyasar confirms the payment.
 */
import { z } from "zod";
import { toAsciiDigits } from "@/lib/i18n/digits";

export const BRAND_DIALECTS = ["khaliji", "msa", "english"] as const;
export type BrandDialect = (typeof BRAND_DIALECTS)[number];

/**
 * Brand-kit input limits shared by the /welcome wizard, the Brand Kit page and the server
 * schemas (this file, POST /api/brand-kit, POST /api/brand-kit/generate), so a page never lets
 * a merchant type what the API then refuses (RA-15).
 */
export const MAX_BRAND_NAME = 200;
export const MAX_BRAND_ESSENCE = 1000;
/** Per item of the attribute / favor-word / avoid-word lists. */
export const MAX_BRAND_ITEM = 60;
export const MAX_BRAND_ATTRIBUTES = 20;
export const MAX_BRAND_WORDS = 50;

const LIST_SEPARATOR = /[,،]/;

function listItems(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(LIST_SEPARATOR)) {
    const value = part.trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

/** Split a list typed with Latin "," or Arabic "،" commas: trimmed, de-duplicated, at most `maxItems`. */
export function splitList(text: string, maxItems: number): string[] {
  return listItems(text).slice(0, maxItems);
}

/** Split a voice-attribute list typed with Latin "," or Arabic "،" commas (trimmed, de-duplicated). */
export function splitAttributes(text: string): string[] {
  return splitList(text, MAX_BRAND_ATTRIBUTES);
}

export type BilingualIssue = { ar: string; en: string };

/**
 * Why a typed list would be refused by the API — an item over MAX_BRAND_ITEM characters (often a
 * list typed without commas), or more than `maxItems` items — or null when it is fine. Pages show
 * it where the list is typed instead of failing on submit.
 */
export function brandListError(text: string, maxItems: number): BilingualIssue | null {
  const items = listItems(text);
  if (items.some((item) => item.length > MAX_BRAND_ITEM)) {
    return {
      ar: `كل عنصر في القائمة يجب ألا يتجاوز ${MAX_BRAND_ITEM} حرفاً — افصل بين العناصر بفاصلة (، أو ,)`,
      en: `Each item must be ${MAX_BRAND_ITEM} characters or fewer — separate items with a comma (، or ,)`
    };
  }
  if (items.length > maxItems) {
    return { ar: `الحد الأقصى ${maxItems} عنصراً`, en: `Use at most ${maxItems} items` };
  }
  return null;
}

export const OnboardingBrandKitSchema = z.strictObject({
  essence: z.string().trim().max(MAX_BRAND_ESSENCE).default(""),
  attributes: z.array(z.string().trim().min(1).max(MAX_BRAND_ITEM)).max(MAX_BRAND_ATTRIBUTES).default([]),
  dialect: z.enum(BRAND_DIALECTS).default("khaliji")
});

export const OnboardingBodySchema = z.strictObject({
  businessName: z.string().trim().min(1).max(MAX_BRAND_NAME),
  /** Optional; 15 digits after Arabic-Indic digit normalisation, or empty when not VAT-registered. */
  vatNumber: z
    .string()
    .transform((v) => toAsciiDigits(v).trim())
    .pipe(z.union([z.literal(""), z.string().regex(/^\d{15}$/, "VAT must be 15 digits")]))
    .optional(),
  dpaAccepted: z.literal(true, { error: "Accept the privacy policy and DPA to continue" }),
  brandKit: OnboardingBrandKitSchema.default({ essence: "", attributes: [], dialect: "khaliji" })
});

export type OnboardingInput = z.infer<typeof OnboardingBodySchema>;
