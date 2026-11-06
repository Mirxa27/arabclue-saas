/** ZOOM-01 — the Input/Textarea primitives' default font size and caller overrides. */
import { describe, expect, it } from "vitest";
import { FIELD_TEXT_SIZE, fieldTextSize, hasFontSizeClass } from "@/lib/ui/field-text-size";

describe("hasFontSizeClass", () => {
  it("detects unconditional font-size utilities", () => {
    for (const cls of ["text-base", "text-xs", "text-sm", "text-lg", "text-2xl", "!text-sm", "text-[13px]", "text-[1.1rem]", "text-[length:var(--x)]"]) {
      expect(hasFontSizeClass(`rounded-xl ${cls} font-mono`), cls).toBe(true);
    }
  });

  it("ignores colours, alignment and variant-scoped sizes", () => {
    for (const cls of ["text-ink", "text-ink-mute/50", "text-[#fff]", "text-right", "text-balance", "sm:text-lg", "[@media(pointer:fine)]:text-sm", "md:text-base"]) {
      expect(hasFontSizeClass(cls), cls).toBe(false);
    }
    expect(hasFontSizeClass(undefined)).toBe(false);
    expect(hasFontSizeClass("")).toBe(false);
  });
});

describe("fieldTextSize", () => {
  it("defaults to 16px with the compact size only for a fine pointer", () => {
    expect(FIELD_TEXT_SIZE).toBe("text-base [@media(pointer:fine)]:text-sm");
    expect(fieldTextSize(undefined)).toBe(FIELD_TEXT_SIZE);
    expect(fieldTextSize("rounded-xl border-rule/80")).toBe(FIELD_TEXT_SIZE);
  });

  it("steps aside when the caller sets a size (the onboarding wizard's text-base stays 16px on desktop)", () => {
    expect(fieldTextSize("rounded-xl border-rule/80 focus:border-ink text-base")).toBeUndefined();
  });
});
