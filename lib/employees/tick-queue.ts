/**
 * Bounded, time-boxed execution for the 24/7 employee tick (F23).
 *
 * Runs `work` over `ids` with at most `concurrency` in flight and stops starting
 * new items once `budgetMs` has elapsed, so a slow LLM-backed tick cannot push
 * the whole run past the route's maxDuration. Items not started are reported as
 * `deferred`; the queue order (least recently ticked first) brings them back first.
 */
export type TickOutcome = {
  id: string;
  ok: boolean;
  tasksAdvanced?: number;
  /** Why the employee was not run (no AI-employees plan, unpaid seat, not active). */
  skipped?: string;
  handedOver?: number;
  blocked?: number;
  error?: string;
};

export type TickWorkResult = { tasksAdvanced: number; skipped?: string; handedOver?: number; blocked?: number };

export async function runTickQueue(
  ids: string[],
  work: (id: string) => Promise<TickWorkResult>,
  opts: { concurrency: number; budgetMs: number; now?: () => number }
): Promise<{ results: TickOutcome[]; deferred: string[] }> {
  const now = opts.now ?? Date.now;
  const started = now();
  const results: TickOutcome[] = [];
  const queue = [...ids];
  const deferred: string[] = [];

  async function worker(): Promise<void> {
    for (;;) {
      const id = queue.shift();
      if (id === undefined) return;
      if (now() - started >= opts.budgetMs) {
        deferred.push(id, ...queue.splice(0));
        return;
      }
      try {
        const r = await work(id);
        results.push({
          id,
          ok: true,
          tasksAdvanced: r.tasksAdvanced,
          ...(r.skipped ? { skipped: r.skipped } : {}),
          ...(r.handedOver ? { handedOver: r.handedOver } : {}),
          ...(r.blocked ? { blocked: r.blocked } : {})
        });
      } catch (err) {
        results.push({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  const n = Math.max(1, Math.min(opts.concurrency, ids.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return { results, deferred };
}
