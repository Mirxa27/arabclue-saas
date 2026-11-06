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

export const MAX_BRAND_ATTRIBUTES = 20;

/** Split a voice-attribute list typed with Latin "," or Arabic "،" commas (trimmed, de-duplicated). */
export function splitAttributes(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[,،]/)) {
    const value = part.trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out.slice(0, MAX_BRAND_ATTRIBUTES);
}

export const OnboardingBrandKitSchema = z.strictObject({
  essence: z.string().trim().max(1000).default(""),
  attributes: z.array(z.string().trim().min(1).max(60)).max(MAX_BRAND_ATTRIBUTES).default([]),
  dialect: z.enum(BRAND_DIALECTS).default("khaliji")
});

export const OnboardingBodySchema = z.strictObject({
  businessName: z.string().trim().min(1).max(200),
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
