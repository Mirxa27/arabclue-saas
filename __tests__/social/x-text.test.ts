/**
 * SW-49: X weighted length (twitter-text config v3 / docs.x.com counting rules) — URLs 23,
 * emoji 2, Arabic 1, CJK 2 — and shortening that never splits an emoji or a link.
 */
import { describe, expect, it } from "vitest";
import { isValidXLength, tokenizeForX, truncateForX, xWeightedLength } from "@/lib/x/text";

describe("xWeightedLength", () => {
  it("counts Arabic and Latin as 1, CJK and symbols outside the weight-1 ranges as 2", () => {
    expect(xWeightedLength("مرحبا")).toBe(5);
    expect(xWeightedLength("hello")).toBe(5);
    expect(xWeightedLength("日本")).toBe(4);
  });

  it("counts every emoji as 2 regardless of complexity", () => {
    expect(xWeightedLength("✨")).toBe(2); // BMP, one code unit — slice() counted it as 1
    expect(xWeightedLength("😀")).toBe(2);
    expect(xWeightedLength("👨‍👩‍👧‍👦")).toBe(2); // ZWJ family
    expect(xWeightedLength("👍🏽")).toBe(2); // skin tone
    expect(xWeightedLength("🇸🇦")).toBe(2); // flag
    expect(xWeightedLength("1️⃣")).toBe(2); // keycap
  });

  it("counts every URL as 23 and keeps trailing punctuation out of it", () => {
    expect(xWeightedLength("https://salla.sa/oud-store/oud-al-layl-premium-collection-2026?ref=social")).toBe(23);
    expect(xWeightedLength("salla.sa")).toBe(23);
    expect(xWeightedLength("زوروا salla.sa/store.")).toBe(6 + 23 + 1);
  });

  it("normalises to NFC first", () => {
    expect(xWeightedLength("café")).toBe(xWeightedLength("café"));
    expect(xWeightedLength("café")).toBe(4);
  });

  it("reproduces the audit's example: 270 Arabic letters + 10 ✨ is 290, not 280", () => {
    const caption = `${"ع".repeat(270)}${"✨".repeat(10)}`;
    expect(caption.length).toBe(280); // what slice(0, 280) measured
    expect(xWeightedLength(caption)).toBe(290);
    expect(isValidXLength(caption)).toBe(false);
  });
});

describe("truncateForX", () => {
  it("returns a fitting caption unchanged", () => {
    expect(truncateForX("مرحبا ✨")).toBe("مرحبا ✨");
  });

  it("fits the limit without splitting emoji or URLs and ends with an ellipsis", () => {
    const long = `${"كلمة ".repeat(60)}✨✨ https://salla.sa/very/long/product/link`;
    const short = truncateForX(long);
    expect(xWeightedLength(short)).toBeLessThanOrEqual(280);
    expect(short.endsWith("…")).toBe(true);
    expect(short).not.toMatch(/https:\/\/salla\.sa\/very\/long\/product\/lin(?!k)/); // never a cut link
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(short)).toBe(false); // no lone surrogate
  });

  it("keeps whole emoji at the boundary", () => {
    const text = `${"a".repeat(276)}😀😀😀`;
    const short = truncateForX(text);
    expect(xWeightedLength(short)).toBeLessThanOrEqual(280);
    for (const token of tokenizeForX(short)) {
      if (token.kind === "emoji") expect(token.text).toBe("😀");
    }
  });
});
