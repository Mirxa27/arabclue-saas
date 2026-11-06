/**
 * AI provider abstraction.
 * Lets us swap between OpenAI, Anthropic, or local KSA-resident providers (HUMAIN/ALLaM)
 * without touching call sites. PDPL-aware: pass `residency: "ksa"` to force in-Kingdom inference
 * once the local model endpoint is plumbed.
 */
import { createOpenAI, openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, generateObject } from "ai";
import { z } from "zod";

export type Residency = "global" | "ksa" | "eu";

export type AICallOptions = {
  system?: string;
  prompt: string;
  model?: string;
  residency?: Residency;
  temperature?: number;
  maxTokens?: number;
};

function resolveModel(name?: string, residency: Residency = "global") {
  // PDPL: when residency is "ksa", route to local provider once the endpoint is configured.
  if (residency === "ksa") {
    if (!process.env.HUMAIN_API_BASE) {
      throw new Error(
        "PDPL: residency='ksa' requested but HUMAIN_API_BASE not configured. " +
          "Set HUMAIN_API_BASE + HUMAIN_API_KEY, or call with residency='global' after obtaining explicit DPA consent."
      );
    }
    const humain = createOpenAI({
      baseURL: process.env.HUMAIN_API_BASE,
      apiKey: process.env.HUMAIN_API_KEY ?? "",
    });
    // `.chat()` targets /chat/completions. The bare provider call defaults to
    // OpenAI's Responses API, which OpenAI-compatible endpoints do not implement.
    return humain.chat(name ?? "allam-b2b");
  }

  if (name?.startsWith("claude")) return anthropic(name);
  return openai(name ?? "gpt-4o-mini");
}

export async function aiText(opts: AICallOptions): Promise<string> {
  const model = resolveModel(opts.model, opts.residency);
  const { text } = await generateText({
    model,
    system: opts.system,
    prompt: opts.prompt,
    temperature: opts.temperature ?? 0.6,
    maxOutputTokens: opts.maxTokens ?? 1200
  });
  return text;
}

export async function aiStructured<T extends z.ZodType>(
  schema: T,
  opts: AICallOptions
): Promise<z.infer<T>> {
  const model = resolveModel(opts.model, opts.residency);
  const { object } = await generateObject({
    model,
    schema,
    system: opts.system,
    prompt: opts.prompt,
    temperature: opts.temperature ?? 0.4,
    maxOutputTokens: opts.maxTokens ?? 1500,
    // @ai-sdk/openai v3 enables OpenAI strict structured outputs by default, and
    // strict mode rejects any schema whose optional/defaulted fields are absent
    // from `required` (ToolDecisionSchema, VisualBriefSchema, ReplyDecisionSchema).
    // Non-strict JSON-schema mode keeps the schema as guidance; the SDK still
    // validates the result against the zod schema before returning it.
    providerOptions: { openai: { strictJsonSchema: false } }
  });
  // generateObject has already validated `object` against `schema` (safeParse in
  // @ai-sdk/provider-utils); TS just cannot relate the SDK's deferred
  // InferSchema<T> to zod 4's conditional output<T>.
  return object as z.infer<T>;
}
