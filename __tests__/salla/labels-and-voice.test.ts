/**
 * UI-001 / UI-034 helpers and the voice tools' Salla calls:
 *  - `?connected=<slug>` only selects a fixed Arabic + English label (no content spoofing);
 *  - Salla action codes map to fixed text, unknown codes to a generic message;
 *  - voice tools resolve the merchant's token through the token helper, never a passed-in token.
 */
import { describe, expect, it, vi } from "vitest";
import { connectedBannerText } from "@/lib/integrations/labels";
import { SALLA_ACTION_MESSAGES, sallaActionMessage } from "@/lib/salla/messages";

const tokens = vi.hoisted(() => ({ sallaApiForMerchant: vi.fn() }));
vi.mock("@/lib/salla/tokens", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/salla/tokens")>()),
  sallaApiForMerchant: tokens.sallaApiForMerchant
}));

import { dispatchVoiceTool, type VoiceToolContext } from "@/lib/voice/agent";

describe("connectedBannerText", () => {
  it("names known platforms with fixed labels", () => {
    expect(connectedBannerText("salla")).toEqual({ ar: "تم ربط سلة بنجاح.", en: "Salla connected successfully." });
    expect(connectedBannerText("whatsapp")?.en).toBe("WhatsApp Business connected successfully.");
  });

  it("never echoes the URL value", () => {
    const spoof = "Your account is suspended. Call +1-555-0100. Instagram";
    expect(connectedBannerText(spoof)).toEqual({ ar: "تم الربط بنجاح.", en: "Connected successfully." });
    expect(connectedBannerText(null)).toBeNull();
    expect(connectedBannerText("")).toBeNull();
  });
});

describe("sallaActionMessage", () => {
  it("maps stable codes to fixed text and anything else to the generic message", () => {
    expect(sallaActionMessage("salla_reconnect_required")).toBe(SALLA_ACTION_MESSAGES.salla_reconnect_required);
    expect(sallaActionMessage("store_already_linked").en).toBe("This Salla store is already linked to another account.");
    expect(sallaActionMessage("<script>")).toBe(SALLA_ACTION_MESSAGES.unknown);
    expect(sallaActionMessage("__proto__")).toBe(SALLA_ACTION_MESSAGES.unknown);
    expect(sallaActionMessage(null)).toBe(SALLA_ACTION_MESSAGES.unknown);
    for (const text of Object.values(SALLA_ACTION_MESSAGES)) {
      expect(text.ar).toMatch(/[؀-ۿ]/);
      expect(text.en).toMatch(/[A-Za-z]/);
    }
  });
});

describe("voice tools use the merchant's Salla connection", () => {
  const ctx = (extra: Partial<VoiceToolContext> = {}): VoiceToolContext => ({
    merchantId: "m-1",
    accessToken: "enc:v1:stale-ciphertext-must-not-be-used",
    persona: { merchantId: "m-1", storeName: "متجر", dialect: "khaliji" },
    // SW-23: lookups only answer for the caller id Twilio verified
    callerNumber: "+966557777777",
    recordBooking: async () => "b1",
    recordEscalation: async () => "e1",
    ...extra
  });

  it("looks up an order through sallaApiForMerchant (refresh + 401 retry), not ctx.accessToken", async () => {
    tokens.sallaApiForMerchant.mockResolvedValue({
      data: [{ id: 1, reference_id: 41027662, status: { name: "قيد التنفيذ" }, customer: { mobile: 557777777, mobile_code: "+966" } }]
    });
    const out = await dispatchVoiceTool({ name: "lookup_order", arguments: { orderNumber: "41027662" } }, ctx());
    expect(tokens.sallaApiForMerchant).toHaveBeenCalledWith("m-1", "/orders?reference_id=41027662");
    expect(out.output).toBe("حالة الطلب: قيد التنفيذ.");
  });

  it("an unusable connection becomes the spoken fallback, not a crash", async () => {
    tokens.sallaApiForMerchant.mockRejectedValue(new Error("salla_reconnect_required"));
    const out = await dispatchVoiceTool({ name: "check_product", arguments: { query: "عود" } }, ctx());
    expect(out.output).toContain("تعذّر التحقق");
  });

  it("accepts an injected Salla client", async () => {
    const salla = vi.fn(async () => ({ data: [{ id: 7, name: "عود ملكي", price: { amount: 250 }, quantity: 2 }] }));
    const out = await dispatchVoiceTool({ name: "check_product", arguments: { query: "عود" } }, ctx({ salla }));
    expect(salla).toHaveBeenCalledWith("/products?keyword=%D8%B9%D9%88%D8%AF");
    expect(out.output).toBe("عود ملكي متوفر بسعر 250 ريال.");
  });
});
