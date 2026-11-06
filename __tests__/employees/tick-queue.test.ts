import { describe, expect, it } from "vitest";
import { runTickQueue } from "@/lib/employees/tick-queue";

describe("runTickQueue (F23)", () => {
  it("never runs more than `concurrency` ticks at once and processes every id", async () => {
    let inFlight = 0;
    let peak = 0;
    const ids = Array.from({ length: 12 }, (_, i) => `e${i}`);
    const { results, deferred } = await runTickQueue(
      ids,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return { tasksAdvanced: 1 };
      },
      { concurrency: 3, budgetMs: 10_000 }
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(results.map((r) => r.id).sort()).toEqual([...ids].sort());
    expect(deferred).toEqual([]);
  });

  it("records failures without stopping the run", async () => {
    const { results } = await runTickQueue(
      ["a", "b"],
      async (id) => {
        if (id === "a") throw new Error("llm timeout");
        return { tasksAdvanced: 2 };
      },
      { concurrency: 2, budgetMs: 10_000 }
    );
    expect(results).toContainEqual({ id: "a", ok: false, error: "llm timeout" });
    expect(results).toContainEqual({ id: "b", ok: true, tasksAdvanced: 2 });
  });

  it("defers the rest once the time budget is spent", async () => {
    let clock = 0;
    const { results, deferred } = await runTickQueue(
      ["a", "b", "c", "d"],
      async () => {
        clock += 30;
        return { tasksAdvanced: 0 };
      },
      { concurrency: 1, budgetMs: 50, now: () => clock }
    );
    expect(results.map((r) => r.id)).toEqual(["a", "b"]);
    expect(deferred).toEqual(["c", "d"]);
  });

  it("handles an empty queue", async () => {
    expect(await runTickQueue([], async () => ({ tasksAdvanced: 0 }), { concurrency: 5, budgetMs: 1000 })).toEqual({
      results: [],
      deferred: []
    });
  });
});
