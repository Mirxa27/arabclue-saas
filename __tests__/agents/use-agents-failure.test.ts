/**
 * RA-11 — a failed agent toggle must leave its error visible. hooks/use-agents.ts used to
 * dispatch SET_ERROR and then the revert (DISABLE/ENABLE), whose reducer clears lastError,
 * so the 402 plan gate of PATCH /api/agents/status was never shown: the card flipped on and
 * back off without a word.
 *
 * The real hook runs here on a minimal hooks runtime (useReducer slots, useCallback = identity,
 * no effects) because the suite has no DOM renderer; every dispatch goes through agentReducer.
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
import { agentReducer, createDefaultAgentState, agentToggleFailed } from "@/lib/agents/store";

const PLAN_MESSAGE = "Social media agent requires an active subscription on a plan that includes this module.";

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

describe("useAgents — failed toggles keep their error (RA-11)", () => {
  it("a 402 plan gate reverts the card to off AND shows why", async () => {
    respond(402, { error: PLAN_MESSAGE });
    await render().toggleAgent("social");

    const social = render().agents.find((a) => a.role === "social")!;
    expect(social.enabled).toBe(false);
    expect(social.status).toBe("idle");
    expect(social.lastError).toBeTruthy();
    // fixed bilingual copy for the plan gate (the server message is English only)
    expect(social.lastError).toMatch(/باقت/);
    expect(social.lastError).toMatch(/plan/i);
  });

  it("enableAgent / disableAgent keep the server's message after reverting", async () => {
    respond(500, { error: "Save agent settings failed" });
    await render().enableAgent("voice");
    let voice = render().agents.find((a) => a.role === "voice")!;
    expect(voice).toMatchObject({ enabled: false, status: "idle", lastError: "Save agent settings failed" });

    // switch it on locally, then a failing switch-off reverts to on with the error
    respond(200, { ok: true });
    await render().enableAgent("seo");
    respond(503, { error: "Database unavailable" });
    await render().disableAgent("seo");
    const seo = render().agents.find((a) => a.role === "seo")!;
    expect(seo).toMatchObject({ enabled: true, status: "active", lastError: "Database unavailable" });

    voice = render().agents.find((a) => a.role === "voice")!;
    expect(voice.lastError).toBe("Save agent settings failed");
  });

  it("a successful toggle clears an earlier error", async () => {
    respond(402, { error: PLAN_MESSAGE });
    await render().toggleAgent("social");
    respond(200, { ok: true });
    await render().toggleAgent("social");
    const social = render().agents.find((a) => a.role === "social")!;
    expect(social).toMatchObject({ enabled: true, status: "active", lastError: null });
  });
});

describe("agentReducer TOGGLE_FAILED", () => {
  it("reverts enabled/status and records the error in one step", () => {
    const toggled = agentReducer(createDefaultAgentState(), { type: "TOGGLE", role: "social" });
    expect(toggled.agents.social.enabled).toBe(true);
    const failed = agentReducer(toggled, agentToggleFailed("social", true, "nope"));
    expect(failed.agents.social).toMatchObject({ enabled: false, status: "idle", lastError: "nope" });
  });
});
