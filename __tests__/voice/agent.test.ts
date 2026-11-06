/**
 * Voice agent instructions and the Realtime session (SW-40, F22):
 *  - the merchant's dialect (or the platform default) shapes the instructions: MSA / English
 *    lines carry no Saudi colloquialisms and greet in their own register with the store's name;
 *  - the session is the GA Realtime shape (type "realtime", supported model, G.711 μ-law for
 *    Twilio, no input transcription) with the four tools.
 */
import { afterEach, describe, it, expect } from "vitest";
import {
  buildRealtimeSession,
  buildRealtimeSessionUpdate,
  buildVoiceInstructions,
  DEFAULT_REALTIME_MODEL,
  realtimeModel,
  voiceGreeting,
  VOICE_TOOLS,
  type VoicePersona
} from "@/lib/voice/agent";
import { resolveVoiceDialect } from "@/lib/voice/dialect";
import { normalizeProduct } from "@/lib/salla/products";

const persona = (over: Partial<VoicePersona> = {}): VoicePersona => ({
  merchantId: "m1",
  storeName: "متجر العود",
  dialect: "khaliji",
  hours: "٩ص – ١١م",
  escalationPhone: "+966500000000",
  ...over
});

const COLLOQUIAL = /أبشر|تأمر|حيّاك/;

afterEach(() => {
  delete process.env.VOICE_REALTIME_MODEL;
});

describe("buildVoiceInstructions — dialect (SW-40)", () => {
  it("khaliji: Saudi register, Saudi phrases, Khaliji greeting with the store name", () => {
    const text = buildVoiceInstructions(persona());
    expect(text).toContain("متجر العود");
    expect(text).toContain("التصعيد");
    expect(text).toContain("بلهجة سعودية خليجية");
    expect(text).toMatch(COLLOQUIAL);
    expect(text).toContain("«حيّاك الله، هاتف متجر العود، معك سالم. كيف أقدر أخدمك؟»");
    expect(text).not.toContain("[اسم المتجر]");
  });

  it("msa: Modern Standard Arabic guide, no colloquialisms, MSA greeting — and differs from khaliji", () => {
    const msa = buildVoiceInstructions(persona({ dialect: "msa" }));
    expect(msa).toContain("بالعربية الفصحى");
    expect(msa).not.toMatch(COLLOQUIAL);
    expect(msa).toContain("«السلام عليكم، هاتف متجر العود، معك سالم. كيف يمكنني مساعدتك؟»");
    expect(msa).not.toBe(buildVoiceInstructions(persona()));
    // the persona's identity survives, only the colloquial sentence is dropped
    expect(msa).toContain("أنت سالم");
  });

  it("english: speaks English (Arabic if the caller does) and greets in English", () => {
    const en = buildVoiceInstructions(persona({ dialect: "english" }));
    expect(en).toContain("Speak clear, polite English");
    expect(en).not.toMatch(COLLOQUIAL);
    expect(en).toContain("Hello, you've reached متجر العود. This is Salem");
  });

  it("never promises transfers or SMS, and scopes order lookups to the caller's own number", () => {
    const text = buildVoiceInstructions(persona());
    expect(text).not.toContain("بنأكد لك عبر رسالة");
    expect(text).toContain("لا تقل إنك ستحوّل المكالمة");
    expect(text).toContain("على رقم الجوال الذي يتصل منه العميل");
  });

  it("bounds the merchant's knowledge and hours even if a row predates the DB constraints", () => {
    const text = buildVoiceInstructions(persona({ knowledge: "س".repeat(10_000), hours: "x".repeat(500) }));
    expect(text).toContain("س".repeat(4000));
    expect(text).not.toContain("س".repeat(4001));
    expect(text).not.toContain("x".repeat(201));
  });

  it("resolves the dialect: merchant choice → brand kit → platform default → khaliji", () => {
    expect(resolveVoiceDialect("msa", "english", "khaliji")).toBe("msa");
    expect(resolveVoiceDialect(null, "english", "msa")).toBe("english");
    expect(resolveVoiceDialect(null, null, "msa")).toBe("msa");
    expect(resolveVoiceDialect(undefined, "klingon", null)).toBe("khaliji");
  });

  it("greets per dialect", () => {
    expect(voiceGreeting("X", "khaliji")).toContain("حيّاك الله");
    expect(voiceGreeting("X", "msa")).toContain("السلام عليكم");
    expect(voiceGreeting("X", "english")).toContain("Hello");
  });
});

describe("Realtime GA session (F22)", () => {
  it("is the GA session object with a supported model, μ-law audio for Twilio and the tools", () => {
    const session = buildRealtimeSession(persona());
    expect(session.type).toBe("realtime");
    expect(session.model).toBe(DEFAULT_REALTIME_MODEL);
    expect(DEFAULT_REALTIME_MODEL).not.toMatch(/preview|^gpt-realtime$|gpt-4o/);
    expect(session.output_modalities).toEqual(["audio"]);
    expect(session.audio.input.format).toEqual({ type: "audio/pcmu" });
    expect(session.audio.output.format).toEqual({ type: "audio/pcmu" });
    expect(session.audio.input.turn_detection.type).toBe("server_vad");
    expect(session.tools.length).toBe(VOICE_TOOLS.length);
    expect(session.tool_choice).toBe("auto");
    // no beta-only fields, no transcripts requested (PDPL: nothing to store)
    expect(session).not.toHaveProperty("modalities");
    expect(session).not.toHaveProperty("input_audio_transcription");
    expect(JSON.stringify(session)).not.toContain("transcription");
    expect(session.instructions).toContain("متجر العود");
  });

  it("wraps it in the session.update client event", () => {
    const event = buildRealtimeSessionUpdate(persona({ dialect: "msa" }));
    expect(event.type).toBe("session.update");
    expect(event.session.instructions).toContain("بالعربية الفصحى");
  });

  it("takes VOICE_REALTIME_MODEL when well-formed, else the default", () => {
    process.env.VOICE_REALTIME_MODEL = "gpt-realtime-2.1-mini";
    expect(realtimeModel()).toBe("gpt-realtime-2.1-mini");
    process.env.VOICE_REALTIME_MODEL = "https://evil.example/x";
    expect(realtimeModel()).toBe(DEFAULT_REALTIME_MODEL);
  });

  it("exposes the four tools; lookup_order takes no caller-supplied phone number", () => {
    const names = VOICE_TOOLS.map((t) => t.name);
    expect(names).toEqual(["lookup_order", "check_product", "book_appointment", "escalate_to_human"]);
    const lookup = VOICE_TOOLS.find((t) => t.name === "lookup_order")!;
    expect(Object.keys(lookup.parameters.properties)).toEqual(["orderNumber"]);
    expect(VOICE_TOOLS.find((t) => t.name === "escalate_to_human")!.description).toContain("does not transfer the call");
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
