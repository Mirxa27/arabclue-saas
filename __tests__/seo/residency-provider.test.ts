/**
 * SW-43: with the admin SEO residency set to KSA and HUMAIN_API_BASE configured, SEO calls go
 * to the HUMAIN (in-Kingdom) provider through the real lib/ai/providers.ts — never
 * openai("gpt-4o-mini") — and the seeded OpenAI model id is not sent to HUMAIN.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  generateObject: vi.fn(async (_opts: Record<string, unknown>) => ({
    object: { title: "t", slug: "s", metaDescription: "m", outline: [], body: "b", keywords: [], internalLinkSuggestions: [] }
  })),
  openai: vi.fn((id: string) => ({ provider: "openai", id })),
  chat: vi.fn((id: string) => ({ provider: "humain-chat", id })),
  createOpenAI: vi.fn()
}));
sdk.createOpenAI.mockImplementation((cfg: Record<string, unknown>) => Object.assign(() => ({ provider: "humain-responses", cfg }), { chat: sdk.chat }));

vi.mock("ai", () => ({ generateObject: sdk.generateObject, generateText: vi.fn() }));
vi.mock("@ai-sdk/openai", () => ({ openai: sdk.openai, createOpenAI: sdk.createOpenAI }));
vi.mock("@ai-sdk/anthropic", () => ({ anthropic: vi.fn() }));

import { generateBlogPost } from "@/lib/seo/copywriter";
import { resolveSeoModel } from "@/lib/seo/model";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = "sk-test";
});

describe("SEO residency → provider", () => {
  it("ksa + HUMAIN configured selects HUMAIN's chat endpoint with its default model", async () => {
    process.env.HUMAIN_API_BASE = "https://humain.example/v1";
    process.env.HUMAIN_API_KEY = "hk";
    const choice = resolveSeoModel({ enabled: true, model: "gpt-4o-mini", residency: "ksa" });
    await generateBlogPost({ topic: "دليل العود", primaryKeyword: "عود", ...choice });
    expect(sdk.createOpenAI).toHaveBeenCalledWith({ baseURL: "https://humain.example/v1", apiKey: "hk" });
    expect(sdk.chat).toHaveBeenCalledWith("allam-b2b");
    expect(sdk.openai).not.toHaveBeenCalled();
    expect(sdk.generateObject.mock.calls[0][0]).toMatchObject({ model: { provider: "humain-chat", id: "allam-b2b" } });
  });

  it("global keeps the configured OpenAI model", async () => {
    delete process.env.HUMAIN_API_BASE;
    const choice = resolveSeoModel({ enabled: true, model: "gpt-4.1-mini", residency: "global" });
    await generateBlogPost({ topic: "دليل العود", primaryKeyword: "عود", ...choice });
    expect(sdk.openai).toHaveBeenCalledWith("gpt-4.1-mini");
    expect(sdk.createOpenAI).not.toHaveBeenCalled();
  });

  it("resolveSeoModel refuses what it cannot honour", () => {
    expect(() => resolveSeoModel({ enabled: true, model: "x", residency: "ksa" }, {})).toThrow(/HUMAIN_API_BASE/);
    expect(() => resolveSeoModel({ enabled: true, model: "x", residency: "eu" }, { OPENAI_API_KEY: "k" })).toThrow(/residency/);
    expect(() => resolveSeoModel({ enabled: true, model: "", residency: "global" }, {})).toThrow(/not configured/);
    expect(resolveSeoModel({ enabled: true, model: "  ", residency: "global" }, { OPENAI_API_KEY: "k" })).toEqual({
      residency: "global",
      model: undefined
    });
    expect(resolveSeoModel({ enabled: true, model: "claude-opus-5-5", residency: "ksa" }, { HUMAIN_API_BASE: "https://h" })).toEqual({
      residency: "ksa",
      model: undefined
    });
  });
});
