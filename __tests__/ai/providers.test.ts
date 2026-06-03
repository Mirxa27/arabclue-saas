import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// Isolate the wrapper from the real SDK + network. vi.hoisted keeps the mock
// state addressable from the hoisted vi.mock factories below.
const mocks = vi.hoisted(() => ({
  generateText: vi.fn(async (_opts: Record<string, unknown>) => ({ text: "hello world" })),
  generateObject: vi.fn(async (_opts: Record<string, unknown>) => ({ object: { ok: true } })),
  openai: vi.fn((id: string) => ({ provider: "openai", id })),
  createOpenAI: vi.fn((cfg: Record<string, unknown>) => (id: string) => ({ provider: "humain", id, cfg })),
  anthropic: vi.fn((id: string) => ({ provider: "anthropic", id }))
}));

vi.mock("ai", () => ({ generateText: mocks.generateText, generateObject: mocks.generateObject }));
vi.mock("@ai-sdk/openai", () => ({ openai: mocks.openai, createOpenAI: mocks.createOpenAI }));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: mocks.anthropic }));

import { aiText, aiStructured } from "@/lib/ai/providers";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.HUMAIN_API_BASE;
  delete process.env.HUMAIN_API_KEY;
});

describe("aiText", () => {
  it("returns the text and forwards options with the v5/v6 maxOutputTokens name", async () => {
    const out = await aiText({ system: "sys", prompt: "hi", temperature: 0.3, maxTokens: 222 });
    expect(out).toBe("hello world");
    const arg = mocks.generateText.mock.calls[0][0];
    expect(arg.system).toBe("sys");
    expect(arg.prompt).toBe("hi");
    expect(arg.temperature).toBe(0.3);
    expect(arg.maxOutputTokens).toBe(222);
    expect("maxTokens" in arg).toBe(false); // the deprecated key must not leak through
  });

  it("defaults to the openai gpt-4o-mini model", async () => {
    await aiText({ prompt: "x" });
    expect(mocks.openai).toHaveBeenCalledWith("gpt-4o-mini");
  });

  it("routes claude* models to the anthropic provider", async () => {
    await aiText({ prompt: "x", model: "claude-3-5-sonnet" });
    expect(mocks.anthropic).toHaveBeenCalledWith("claude-3-5-sonnet");
    expect(mocks.openai).not.toHaveBeenCalled();
  });
});

describe("aiStructured", () => {
  it("returns the parsed object and passes the zod schema through", async () => {
    const schema = z.object({ ok: z.boolean() });
    const out = await aiStructured(schema, { prompt: "x", maxTokens: 800 });
    expect(out).toEqual({ ok: true });
    const arg = mocks.generateObject.mock.calls[0][0];
    expect(arg.schema).toBe(schema);
    expect(arg.maxOutputTokens).toBe(800);
  });
});

describe("PDPL residency routing", () => {
  it("throws when residency='ksa' but no in-Kingdom endpoint is configured", async () => {
    await expect(aiText({ prompt: "x", residency: "ksa" })).rejects.toThrow(/HUMAIN_API_BASE/);
  });

  it("routes residency='ksa' to the local provider when configured", async () => {
    process.env.HUMAIN_API_BASE = "https://humain.local/v1";
    process.env.HUMAIN_API_KEY = "k";
    await aiText({ prompt: "x", residency: "ksa", model: "allam-b2b" });
    expect(mocks.createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "https://humain.local/v1", apiKey: "k" })
    );
    expect(mocks.anthropic).not.toHaveBeenCalled();
  });
});
