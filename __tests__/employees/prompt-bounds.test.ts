/**
 * RE-1: chat history and task text reach the model bounded, however large they are stored (the
 * owner can write ai_employee_messages / ai_employee_tasks straight through the Data API).
 * The real runtime, tool router and tick run; the model, Supabase (in-memory) and fetch are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, type Row } from "../helpers/memory-db";

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("../helpers/memory-db").createMemoryDb>,
  decision: { use_tool: false, tool: "none" } as Record<string, unknown>
}));

vi.mock("@/lib/db/supabase", () => ({ getServiceSupabase: () => h.db.client }));
vi.mock("@/lib/ai/providers", () => ({
  aiText: vi.fn(async () => "ok"),
  aiStructured: vi.fn(async () => h.decision)
}));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn(), redactSensitive: (s: string) => s }));

import { persistMessage, respond, tick } from "@/lib/employees/runtime";
import { aiStructured, aiText } from "@/lib/ai/providers";
import { MESSAGE_CONTENT_MAX_CHARS, sliceText, truncateText } from "@/lib/employees/text-bounds";

const EMP = "99999999-9999-4999-8999-999999999901";
const DASH = "99999999-9999-4999-8999-999999999902";
const past = new Date(Date.now() - 3600_000).toISOString();

function seed(extra: Record<string, Row[]> = {}) {
  h.db = createMemoryDb({
    ai_employees: [
      {
        id: EMP,
        merchant_id: "m1",
        role_id: "support-agent",
        display_name: "Noura",
        language: "en",
        tone: "friendly",
        timezone: "Asia/Riyadh",
        working_hours: { mode: "always", start: "00:00", end: "23:59", days: [0, 1, 2, 3, 4, 5, 6] },
        knowledge: null,
        goals: [],
        status: "active",
        billing_status: "trial",
        trial_ends_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
        next_billing_at: null,
        config: {}
      }
    ],
    merchants: [{ id: "m1", owner_user_id: "u1", plan: "plus", subscription_status: "active", dpa_version: "2026-11" }],
    ai_employee_conversations: [{ id: DASH, employee_id: EMP, channel: "dashboard", external_id: `dashboard:${EMP}`, status: "open", unread_count: 0 }],
    ...extra
  });
}

/** 20 stored messages of ~100k characters, newest first (as the descending query returns them). */
function hugeHistory(): Row[] {
  return Array.from({ length: 20 }, (_, i) => 19 - i).map((n) => ({
    id: `msg-${n}`,
    conversation_id: DASH,
    role: n % 2 ? "assistant" : "user",
    content: `#${n}# ${"x".repeat(100_000)}`,
    created_at: new Date(Date.now() - (20 - n) * 60_000).toISOString()
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  h.decision = { use_tool: false, tool: "none" };
});
afterEach(() => vi.unstubAllGlobals());

describe("RE-1: the transcript is bounded per message and in total", () => {
  it("20 stored messages of 100k characters reach the tool router and the reply bounded, newest kept", async () => {
    seed({ ai_employee_messages: hugeHistory() });
    await respond({ employeeId: EMP, conversationId: DASH, userMessage: "what did I ask last?", origin: "merchant" });

    const router = vi.mocked(aiStructured).mock.calls[0][1] as { prompt: string };
    const reply = vi.mocked(aiText).mock.calls[0][0] as { prompt: string };
    for (const prompt of [router.prompt, reply.prompt]) {
      // Was ~2,000,000 characters for each of the two calls per turn.
      expect(prompt.length).toBeLessThanOrEqual(24_000 + 200);
      expect(prompt).toContain("#19#");
      expect(prompt).not.toContain("#0#");
      expect(prompt).toContain("(earlier messages omitted)");
      expect(prompt).not.toContain("x".repeat(4001));
      expect(prompt).toContain("what did I ask last?");
    }
  });

  it("a short history is passed through unchanged", async () => {
    seed({
      ai_employee_messages: [
        { id: "b", conversation_id: DASH, role: "assistant", content: "Hello, how can I help?", created_at: past },
        { id: "a", conversation_id: DASH, role: "user", content: "Hi", created_at: past }
      ]
    });
    await respond({ employeeId: EMP, conversationId: DASH, userMessage: "thanks", origin: "merchant" });
    const reply = vi.mocked(aiText).mock.calls[0][0] as { prompt: string };
    expect(reply.prompt).toBe("Owner: Hi\nYou: Hello, how can I help?\nOwner: thanks\nYou:");
  });
});

describe("RE-1: a task's title and description reach the model at their API sizes", () => {
  it("a task stored with a 50k title and a 400k description is bounded in decideTool", async () => {
    seed({
      ai_employee_tasks: [
        {
          id: "t-huge",
          employee_id: EMP,
          title: "T".repeat(50_000),
          description: "D".repeat(400_000),
          source: "user",
          priority: "normal",
          status: "todo",
          due_at: past,
          result: null,
          assignee: "agent",
          kind: "task",
          payload: { origin: "merchant" },
          conversation_id: null
        }
      ]
    });
    h.decision = { use_tool: false, tool: "none", reasoning: "needs the owner" };
    await tick(EMP);

    const call = vi.mocked(aiStructured).mock.calls[0][1] as { prompt: string };
    // Was 450,223 characters.
    expect(call.prompt.length).toBeLessThan(2_600);
    expect(call.prompt).toContain(`Task: ${"T".repeat(199)}…`);
    expect(call.prompt).not.toContain("T".repeat(201));
    expect(call.prompt).toContain(`Details: ${"D".repeat(1999)}…`);
    expect(call.prompt).not.toContain("D".repeat(2001));
  });
});

describe("RE-1: stored messages stay within the database bound", () => {
  it("persistMessage cuts content to ai_employee_messages_content_size", async () => {
    seed();
    await persistMessage({ conversationId: DASH, role: "tool", content: "y".repeat(20_000) });
    const stored = h.db.table("ai_employee_messages").at(-1) as Row;
    expect(String(stored.content).length).toBe(MESSAGE_CONTENT_MAX_CHARS);
  });

  it("cuts never split a surrogate pair", () => {
    expect(sliceText("a😀b", 2)).toBe("a");
    expect(truncateText("a😀b", 3)).toBe("a…");
    expect(truncateText("short", 10)).toBe("short");
    expect(truncateText("abcdef", 4)).toBe("abc…");
  });
});
