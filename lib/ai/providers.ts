/**
 * AI provider abstraction.
 * Lets us swap between OpenAI, Anthropic, or local KSA-resident providers (HUMAIN/ALLaM)
 * without touching call sites. PDPL-aware: pass `residency: "ksa"` to force in-Kingdom inference
 * once the local model endpoint is plumbed.
 */
import { openai } from "@ai-sdk/openai";
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
  // For now we throw to make the dependency explicit; do NOT silently fall back.
  if (residency === "ksa") {
    if (!process.env.HUMAIN_API_BASE) {
      throw new Error(
        "PDPL: residency='ksa' requested but HUMAIN_API_BASE not configured. " +
          "Set HUMAIN_API_BASE + HUMAIN_API_KEY, or call with residency='global' after obtaining explicit DPA consent."
      );
    }
    // Wire up a custom OpenAI-compatible provider pointed at HUMAIN once available.
    // Placeholder — implement when ALLaM B2B API endpoint is exposed.
    throw new Error("HUMAIN provider not yet wired. Pending public B2B API.");
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
    maxTokens: opts.maxTokens ?? 1200
  });
  return text;
}

export async function aiStructured<T extends z.ZodTypeAny>(
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
    maxTokens: opts.maxTokens ?? 1500
  });
  return object;
}
