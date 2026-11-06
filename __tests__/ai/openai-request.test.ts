/**
 * Exercises the real `ai` + `@ai-sdk/openai` stack (only `fetch` is stubbed) to
 * pin the wire format of structured calls.
 *
 * @ai-sdk/openai v3 turns on OpenAI strict structured outputs by default, and
 * OpenAI rejects strict schemas whose optional fields are missing from
 * `required` — which is the case for ToolDecisionSchema and friends. The wrapper
 * must therefore send `strict: false`; the SDK still validates the reply with zod.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { aiStructured } from "@/lib/ai/providers";
import { ToolDecisionSchema } from "@/lib/employees/tools";

type Captured = { url: string; body: { text?: { format?: { type?: string; strict?: boolean; schema?: { required?: string[] } } } } };

function stubOpenAI(replyJson: unknown): Captured[] {
  const calls: Captured[] = [];
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(
        JSON.stringify({
          id: "resp_1",
          object: "response",
          created_at: 1,
          model: "gpt-4o-mini",
          status: "completed",
          output: [
            {
              type: "message",
              id: "msg_1",
              status: "completed",
              role: "assistant",
              content: [{ type: "output_text", text: JSON.stringify(replyJson), annotations: [] }]
            }
          ],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    })
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("aiStructured → OpenAI wire format", () => {
  it("sends a non-strict json_schema format and returns the validated object", async () => {
    const calls = stubOpenAI({ a: "x" });
    const out = await aiStructured(z.object({ a: z.string(), b: z.string().optional() }), { prompt: "hi" });
    expect(out).toEqual({ a: "x" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.openai.com/v1/responses");
    expect(calls[0].body.text?.format?.type).toBe("json_schema");
    expect(calls[0].body.text?.format?.strict).toBe(false);
  });

  it("can route the employee tool decision schema (optional fields) without strict mode", async () => {
    const calls = stubOpenAI({ use_tool: false });
    const out = await aiStructured(ToolDecisionSchema, { prompt: "hi" });
    expect(out.use_tool).toBe(false);
    // Optional/defaulted fields are absent from `required` — exactly what strict mode rejects.
    expect(calls[0].body.text?.format?.schema?.required).toEqual(["use_tool"]);
    expect(calls[0].body.text?.format?.strict).toBe(false);
  });

  it("rejects a reply that violates the zod schema instead of returning it", async () => {
    stubOpenAI({ a: 42 });
    await expect(aiStructured(z.object({ a: z.string() }), { prompt: "hi" })).rejects.toThrow();
  });
});
