/**
 * SW-44: the English SEO schemas are pinned like every other LLM wire schema
 * (__tests__/ai/llm-schemas.test.ts, critic-10): same shape as the Arabic ones, descriptions
 * that ask for English, no additional properties.
 */
import { describe, expect, it } from "vitest";
import { zodSchema } from "ai";
import type { ZodType } from "zod";
import { BlogPostSchema, BlogPostSchemaEn, ProductCopySchema, ProductCopySchemaEn } from "@/lib/seo/copywriter";

async function wire(schema: ZodType): Promise<Record<string, unknown>> {
  return (await zodSchema(schema).jsonSchema) as Record<string, unknown>;
}

describe("English SEO schemas (wire format)", () => {
  it.each([
    ["ProductCopySchemaEn", ProductCopySchemaEn, ProductCopySchema],
    ["BlogPostSchemaEn", BlogPostSchemaEn, BlogPostSchema]
  ] as const)("%s matches its pinned JSON Schema and the Arabic schema's shape", async (_name, en, ar) => {
    const enWire = await wire(en);
    const arWire = await wire(ar);
    expect(enWire).toMatchSnapshot();
    expect(enWire.required).toEqual(arWire.required);
    expect(Object.keys(enWire.properties as object)).toEqual(Object.keys(arWire.properties as object));
    expect(enWire.additionalProperties).toBe(false);
    expect(JSON.stringify(enWire)).not.toMatch(/Arabic/);
  });
});
