/**
 * The seller block of every ZATCA document comes from the merchant's tax profile (Settings → ZATCA
 * tax details). ZATCA rejects documents whose seller address is incomplete (BR-KSA-09/37/66) and only
 * accepts the VAT number the CSID was issued for, so the profile is checked before onboarding and
 * before each document, with messages the merchant can act on.
 */
import { toAsciiDigits } from "@/lib/i18n/digits";
import type { Merchant, SellerAddress } from "@/lib/types/database";
import type { SellerInfo } from "@/lib/zatca/invoice";
import { VAT_NUMBER_RE } from "@/lib/zatca/csr";

export type TaxProfileProblem =
  | "seller_name"
  | "vat_number"
  | "street"
  | "building"
  | "district"
  | "city"
  | "postal_code"
  | "cr_number";

export const TAX_PROFILE_PROBLEM_TEXT: Record<TaxProfileProblem, { en: string; ar: string }> = {
  seller_name: { en: "Seller legal name is missing", ar: "الاسم القانوني للبائع مفقود" },
  vat_number: { en: "VAT number must be 15 digits starting and ending with 3", ar: "الرقم الضريبي يجب أن يكون 15 رقماً يبدأ وينتهي بالرقم 3" },
  street: { en: "Street name is missing", ar: "اسم الشارع مفقود" },
  building: { en: "Building number must be 4 digits", ar: "رقم المبنى يجب أن يكون 4 أرقام" },
  district: { en: "District is missing", ar: "الحي مفقود" },
  city: { en: "City is missing", ar: "المدينة مفقودة" },
  postal_code: { en: "Postal code must be 5 digits", ar: "الرمز البريدي يجب أن يكون 5 أرقام" },
  cr_number: { en: "CR number must be 10 digits", ar: "رقم السجل التجاري يجب أن يكون 10 أرقام" }
};

type SellerSource = Pick<Merchant, "seller_name" | "vat_number" | "cr_number" | "seller_address">;

const clean = (v: unknown) => (typeof v === "string" ? toAsciiDigits(v).trim() : "");

export function taxProfileProblems(m: SellerSource): TaxProfileProblem[] {
  const problems: TaxProfileProblem[] = [];
  const a = (m.seller_address ?? {}) as Partial<SellerAddress>;
  if (!clean(m.seller_name)) problems.push("seller_name");
  if (!VAT_NUMBER_RE.test(clean(m.vat_number))) problems.push("vat_number");
  if (!clean(a.street)) problems.push("street");
  if (!/^\d{4}$/.test(clean(a.building))) problems.push("building");
  if (!clean(a.district)) problems.push("district");
  if (!clean(a.city)) problems.push("city");
  if (!/^\d{5}$/.test(clean(a.postalCode))) problems.push("postal_code");
  const cr = clean(m.cr_number);
  if (cr && !/^\d{10}$/.test(cr)) problems.push("cr_number");
  return problems;
}

export function describeTaxProfileProblems(problems: TaxProfileProblem[]): string {
  return problems.map((p) => `${TAX_PROFILE_PROBLEM_TEXT[p].en} / ${TAX_PROFILE_PROBLEM_TEXT[p].ar}`).join("; ");
}

/** SellerInfo for a valid profile (callers check taxProfileProblems first). */
export function sellerFromMerchant(m: SellerSource): SellerInfo {
  const a = (m.seller_address ?? {}) as Partial<SellerAddress>;
  const cr = clean(m.cr_number);
  return {
    name: (m.seller_name ?? "").trim(),
    vatNumber: clean(m.vat_number),
    crNumber: cr || undefined,
    address: {
      street: (a.street ?? "").trim(),
      building: clean(a.building),
      district: (a.district ?? "").trim(),
      city: (a.city ?? "").trim(),
      postalCode: clean(a.postalCode)
    }
  };
}
