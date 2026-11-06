/**
 * Size-bounded zod helpers for request bodies.
 *
 * zod 4.6's capSize only short-circuits arrays / maps / sets that declare .max():
 * a z.record() walks every key before any refinement could reject it
 * (GHSA-mrhx-c7xc-m3w5). boundedRecord() counts keys first — with an early exit —
 * and only then hands the value to the record schema.
 */
import { z } from "zod";

/** True when `value` is not an object, or has at most `max` enumerable keys (stops counting at max + 1). */
export function hasAtMostKeys(value: unknown, max: number): boolean {
  if (!value || typeof value !== "object") return true;
  let n = 0;
  for (const _key in value as Record<string, unknown>) {
    n += 1;
    if (n > max) return false;
  }
  return true;
}

/** z.record(key, value) that rejects more than `maxKeys` keys before parsing any entry. */
export function boundedRecord<Key extends z.core.$ZodRecordKey, Value extends z.core.SomeType>(
  maxKeys: number,
  key: Key,
  value: Value
) {
  return z
    .unknown()
    .refine((v) => hasAtMostKeys(v, maxKeys), { message: `at most ${maxKeys} keys` })
    .pipe(z.record(key, value));
}
