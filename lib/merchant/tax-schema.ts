import { z } from "zod";
import { toAsciiDigits } from "@/lib/i18n/digits";

/** Trimmed string with Arabic-Indic digits normalised to ASCII before the regex check. */
const digits = (re: RegExp, message: string) =>
  z
    .string()
    .transform((v) => toAsciiDigits(v).trim())
    .pipe(z.string().regex(re, message));

export const TaxSettingsSchema = z.object({
  seller_name: z.string().trim().min(1).max(200),
  vat_number: digits(/^\d{15}$/, "VAT must be 15 digits"),
  cr_number: z.union([digits(/^\d{10}$/, "CR must be 10 digits"), z.literal("")]).optional(),
  seller_address: z.object({
    street: z.string().max(200),
    building: z.string().transform((v) => toAsciiDigits(v).trim()).pipe(z.string().max(20)),
    city: z.string().max(100),
    postalCode: digits(/^\d{5}$/, "Postal code must be 5 digits"),
    district: z.string().max(100).optional()
  })
});
