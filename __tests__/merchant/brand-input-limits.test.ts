/**
 * RA-15 — what the /welcome wizard and the Brand Kit page let a merchant type must be what the
 * server schemas accept:
 *  - the store name (up to 200 characters, the legal/CR name) and the essence (up to 1,000) are
 *    accepted by POST /api/brand-kit/generate, which capped them at 120 / 500;
 *  - a voice attribute / favor / avoid word over 60 characters is caught on the page (with a
 *    bilingual message) instead of failing at the last wizard step or on save;
 *  - Arabic "،" separates list items on the Brand page too (it split on "," only, so a
 *    "،"-separated list became one over-long item).
 */
import { describe, expect, it } from "vitest";
import { BrandKitGenerateBodySchema } from "@/lib/agents/brand-kit-generator";
import {
  MAX_BRAND_ATTRIBUTES,
  MAX_BRAND_ESSENCE,
  MAX_BRAND_ITEM,
  MAX_BRAND_NAME,
  MAX_BRAND_WORDS,
  OnboardingBodySchema,
  brandListError,
  splitAttributes,
  splitList
} from "@/lib/merchant/onboarding-schema";

const wizardBody = (name: string, essence: string, attributes: string) => ({
  businessName: name,
  vatNumber: "",
  dpaAccepted: true,
  brandKit: { essence, attributes: splitAttributes(attributes), dialect: "khaliji" }
});

describe("AI generation accepts everything the inputs allow", () => {
  it("a 200-character store name and a 1,000-character essence", () => {
    const name = "م".repeat(MAX_BRAND_NAME);
    const essence = "عود ".repeat(MAX_BRAND_ESSENCE / 4);
    expect(essence.length).toBe(MAX_BRAND_ESSENCE);
    expect(OnboardingBodySchema.safeParse(wizardBody(name, essence, "")).success).toBe(true);
    const generate = BrandKitGenerateBodySchema.safeParse({ brand_name: name, description: essence });
    expect(generate.success).toBe(true);
  });

  it("still rejects input over the shared limits", () => {
    expect(BrandKitGenerateBodySchema.safeParse({ brand_name: "x".repeat(MAX_BRAND_NAME + 1) }).success).toBe(false);
    expect(BrandKitGenerateBodySchema.safeParse({ brand_name: "x", description: "x".repeat(MAX_BRAND_ESSENCE + 1) }).success).toBe(false);
  });
});

describe("list items are checked where they are typed", () => {
  it("flags an attribute over 60 characters (the API would reject it at step 5)", () => {
    const long = "luxury premium oud for modern Saudi households who love tradition"; // 65 chars, no comma
    expect(long.length).toBeGreaterThan(MAX_BRAND_ITEM);
    const issue = brandListError(long, MAX_BRAND_ATTRIBUTES);
    expect(issue?.en).toMatch(/60 characters/);
    expect(issue?.ar).toMatch(/60/);
    // and the wizard body it would have produced is indeed refused by the server schema
    expect(OnboardingBodySchema.safeParse(wizardBody("Store", "", long)).success).toBe(false);
  });

  it("accepts items at the limit, separated by either comma", () => {
    const ok = `${"a".repeat(MAX_BRAND_ITEM)}، warm, أصيل`;
    expect(brandListError(ok, MAX_BRAND_ATTRIBUTES)).toBeNull();
    expect(OnboardingBodySchema.safeParse(wizardBody("Store", "", ok)).success).toBe(true);
    expect(brandListError("", MAX_BRAND_ATTRIBUTES)).toBeNull();
  });

  it("flags more items than the list allows instead of dropping them silently", () => {
    const many = Array.from({ length: MAX_BRAND_ATTRIBUTES + 1 }, (_, i) => `سمة${i}`).join("، ");
    expect(brandListError(many, MAX_BRAND_ATTRIBUTES)?.en).toMatch(new RegExp(`${MAX_BRAND_ATTRIBUTES}`));
  });
});

describe("splitList (Brand page favor/avoid words)", () => {
  it("splits an Arabic-comma list into its words (12 words, not one 76-character item)", () => {
    const words = ["أصالة", "تراث", "فخامة", "عود", "جودة", "ضيافة", "كرم", "هيل", "بخور", "دهن", "مسك", "عنبر"];
    const typed = words.join("، ");
    expect(typed.length).toBeGreaterThan(MAX_BRAND_ITEM);
    expect(splitList(typed, MAX_BRAND_WORDS)).toEqual(words);
    expect(brandListError(typed, MAX_BRAND_WORDS)).toBeNull();
  });

  it("keeps up to the word-list cap (50), not the attribute cap (20)", () => {
    const words = Array.from({ length: 30 }, (_, i) => `w${i}`);
    expect(splitList(words.join(", "), MAX_BRAND_WORDS)).toHaveLength(30);
    expect(splitAttributes(words.join(", "))).toHaveLength(MAX_BRAND_ATTRIBUTES);
  });

  it("trims, drops empty items and de-duplicates", () => {
    expect(splitList(" a ,, b،a ، ", MAX_BRAND_WORDS)).toEqual(["a", "b"]);
  });
});
