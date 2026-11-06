/**
 * Phone handling on the voice path: E.164 normalisation of merchant / caller input, the masked
 * form the platform log keeps (SW-45) and the Salla matching helpers (SW-23).
 */
import { describe, expect, it } from "vitest";
import { customerPhoneDigits, isE164, maskPhone, normalizePhoneE164, phoneSearchKeyword } from "@/lib/voice/phone";

describe("normalizePhoneE164", () => {
  it.each([
    ["+966551234567", "+966551234567"],
    ["0551234567", "+966551234567"],
    ["551234567", "+966551234567"],
    ["966551234567", "+966551234567"],
    ["00966551234567", "+966551234567"],
    ["٠٥٥١٢٣٤٥٦٧", "+966551234567"],
    ["055-123 4567", "+966551234567"],
    ["+971501234567", "+971501234567"],
    ["+1 (415) 555-0100", "+14155550100"]
  ])("%s → %s", (raw, e164) => {
    expect(normalizePhoneE164(raw)).toBe(e164);
  });

  it.each([["12"], ["call me"], [""], ["+0123456789"], ["0123"], ["+1234567890123456"]])("%s is not dialable", (raw) => {
    expect(normalizePhoneE164(raw)).toBeNull();
  });

  it("isE164", () => {
    expect(isE164("+966551234567")).toBe(true);
    expect(isE164("0551234567")).toBe(false);
    expect(isE164(null)).toBe(false);
  });
});

describe("maskPhone (SW-45)", () => {
  it("keeps the last four digits only", () => {
    expect(maskPhone("+966551234567")).toBe("•••• 4567");
    expect(maskPhone("anonymous")).toBeNull();
    expect(maskPhone(undefined)).toBeNull();
  });
});

describe("Salla matching (SW-23)", () => {
  it("rebuilds the order customer's international number from mobile + mobile_code", () => {
    expect(customerPhoneDigits(557777777, "+966")).toBe("966557777777");
    expect(customerPhoneDigits("0557777777", "+966")).toBe("966557777777");
    expect(customerPhoneDigits("966557777777", "+966")).toBe("966557777777");
    expect(customerPhoneDigits(null, "+966")).toBeNull();
  });

  it("searches Salla by the national number the way Salla stores it", () => {
    expect(phoneSearchKeyword("+966551234567")).toBe("551234567");
    expect(phoneSearchKeyword("+971501234567")).toBe("501234567");
    expect(phoneSearchKeyword("+14155550100")).toBe("4155550100");
  });
});
