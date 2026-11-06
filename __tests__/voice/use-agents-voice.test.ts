/**
 * SW-21 (client): after تشغيل the overview card shows what the server saved, not the optimistic
 * toggle — voice without a phone number is "configuring", never a pulsing "Active".
 * Same minimal hooks runtime as __tests__/agents/use-agents-failure.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => {
  type Slot = { state: unknown; reducer: (state: unknown, action: unknown) => unknown };
  const slots: Slot[] = [];
  let cursor = 0;
  return {
    reset() {
      slots.length = 0;
      cursor = 0;
    },
    render() {
      cursor = 0;
    },
    useReducer(reducer: (state: unknown, action: unknown) => unknown, initial: unknown) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { state: initial, reducer };
      const slot = slots[index];
      const dispatch = (action: unknown) => {
        slot.state = slot.reducer(slot.state, action);
      };
      return [slot.state, dispatch];
    }
  };
});

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useReducer: runtime.useReducer,
  useCallback: <T,>(fn: T) => fn,
  useEffect: () => undefined
}));

import { useAgents } from "@/hooks/use-agents";

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }))
  );
}

function render() {
  runtime.render();
  return useAgents();
}

beforeEach(() => runtime.reset());
afterEach(() => vi.unstubAllGlobals());

describe("useAgents — the server's saved state wins (SW-21)", () => {
  it("switching voice on without a number shows 'configuring'", async () => {
    respond(200, { ok: true, agent: { role: "voice", enabled: true, status: "configuring", lastError: null, overrides: null, updatedAt: null } });
    await render().toggleAgent("voice");
    const voice = render().agents.find((a) => a.role === "voice")!;
    expect(voice).toMatchObject({ enabled: true, status: "configuring" });
  });

  it("other agents are untouched by the voice entry", async () => {
    respond(200, { ok: true, agent: { role: "voice", enabled: true, status: "active", lastError: null } });
    await render().toggleAgent("voice");
    expect(render().agents.find((a) => a.role === "social")).toMatchObject({ enabled: false, status: "idle" });
  });

  it("a response without an entry keeps the optimistic toggle", async () => {
    respond(200, { ok: true });
    await render().toggleAgent("seo");
    expect(render().agents.find((a) => a.role === "seo")).toMatchObject({ enabled: true, status: "active" });
  });
});
