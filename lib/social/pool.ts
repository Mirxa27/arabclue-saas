/**
 * Bounded-concurrency map for paid fan-out (LLM calls). At most `concurrency` tasks run at once,
 * and once `maxFailures` tasks have failed no new task starts — so a systemic failure (quota,
 * bad key, provider outage) stops the spend instead of firing every remaining call.
 */
export type PoolOutcome<R> = { ok: true; value: R } | { ok: false; error: unknown } | { ok: false; skipped: true };

export async function runBounded<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  opts: { concurrency: number; maxFailures: number }
): Promise<{ results: PoolOutcome<R>[]; failures: number; stoppedEarly: boolean }> {
  const results: PoolOutcome<R>[] = items.map(() => ({ ok: false, skipped: true }) as const);
  let next = 0;
  let failures = 0;
  let stoppedEarly = false;

  async function lane() {
    for (;;) {
      if (failures >= opts.maxFailures) {
        if (next < items.length) stoppedEarly = true;
        return;
      }
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        failures += 1;
        results[index] = { ok: false, error };
      }
    }
  }

  const lanes = Math.max(1, Math.min(opts.concurrency, items.length));
  await Promise.all(Array.from({ length: lanes }, () => lane()));
  return { results, failures, stoppedEarly };
}
