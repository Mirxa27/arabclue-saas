/**
 * Pins the JSON Schema the AI SDK sends to the model for every structured LLM
 * call (critic-10). A zod or @ai-sdk/* upgrade that changes the wire shape —
 * `required` lists, additionalProperties, formats — shows up as a snapshot diff
 * instead of a silent production regression.
 */
import { describe, expect, it } from "vitest";
import { zodSchema } from "ai";
import type { ZodType } from "zod";
import { ToolDecisionSchema } from "@/lib/employees/tools";
import { CopySchema, PlannedPostSchema, ReplyDecisionSchema, VisualBriefSchema } from "@/lib/social/types";
import { PlannerOutputSchema } from "@/lib/social/agent";
import { BlogPostSchema, ProductCopySchema } from "@/lib/seo/copywriter";

const SCHEMAS: Record<string, ZodType> = {
  ToolDecisionSchema,
  PlannedPostSchema,
  PlannerOutputSchema,
  CopySchema,
  VisualBriefSchema,
  ReplyDecisionSchema,
  ProductCopySchema,
  BlogPostSchema
};

async function wire(schema: ZodType): Promise<Record<string, unknown>> {
  return (await zodSchema(schema).jsonSchema) as Record<string, unknown>;
}

describe("LLM structured-output schemas (wire format)", () => {
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    it(`${name} matches its pinned JSON Schema`, async () => {
      expect(await wire(schema)).toMatchSnapshot();
    });
  }

  it("every object node forbids additional properties", async () => {
    const offenders: string[] = [];
    const visit = (node: unknown, path: string) => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.type === "object" && n.properties && n.additionalProperties !== false) offenders.push(path);
      for (const [k, v] of Object.entries(n)) if (v && typeof v === "object") visit(v, `${path}.${k}`);
    };
    for (const [name, schema] of Object.entries(SCHEMAS)) visit(await wire(schema), name);
    expect(offenders).toEqual([]);
  });

  it("the tool router only requires use_tool (optional fields stay optional; strict mode is off)", async () => {
    expect((await wire(ToolDecisionSchema)).required).toEqual(["use_tool"]);
  });
});
