import { describe, it, expect } from "vitest";
import { buildVoiceInstructions, buildRealtimeSessionConfig, VOICE_TOOLS } from "@/lib/voice/agent";
import { normalizeProduct } from "@/lib/salla/products";

describe("voice agent", () => {
  const persona = {
    merchantId: "m1",
    storeName: "متجر العود",
    dialect: "khaliji" as const,
    hours: "٩ص – ١١م",
    escalationPhone: "+966500000000"
  };

  it("builds Arabic instructions including the store name", () => {
    const text = buildVoiceInstructions(persona);
    expect(text).toContain("متجر العود");
    expect(text).toContain("التصعيد");
  });

  it("emits a valid realtime session config with tools", () => {
    const cfg = buildRealtimeSessionConfig(persona);
    expect(cfg.type).toBe("session.update");
    expect(cfg.session.tools.length).toBe(VOICE_TOOLS.length);
    expect(cfg.session.input_audio_transcription.language).toBe("ar");
  });

  it("exposes an escalation tool", () => {
    const names = VOICE_TOOLS.map((t) => t.name);
    expect(names).toContain("escalate_to_human");
    expect(names).toContain("lookup_order");
  });
});

describe("salla product normalization", () => {
  it("strips HTML and resolves nested price", () => {
    const p = normalizeProduct({
      id: 42,
      name: "Oud",
      description: "<p>Rich <b>oud</b></p>",
      price: { amount: 250, currency: "SAR" },
      categories: [{ name: "Perfume" }],
      quantity: 5
    });
    expect(p.id).toBe("42");
    expect(p.description).toBe("Rich oud");
    expect(p.price).toBe(250);
    expect(p.category).toBe("Perfume");
    expect(p.inventory).toBe(5);
  });

  it("handles flat numeric price", () => {
    const p = normalizeProduct({ id: "x", name: "Item", price: 99 });
    expect(p.price).toBe(99);
    expect(p.category).toBe("general");
  });
});
