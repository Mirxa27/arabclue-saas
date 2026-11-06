import { z } from "zod";

/**
 * ISO-8601 UTC timestamp, with or without seconds ("2026-11-05T12:00Z" or
 * "2026-11-05T12:00:00.000Z"). zod 4's `z.iso.datetime()` requires seconds;
 * the union keeps the minute-precision form zod 3 accepted.
 */
export const IsoDateTimeSchema = z.union([z.iso.datetime(), z.iso.datetime({ precision: -1 })]);

export const TaskCreateSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(2000).optional().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  due_at: IsoDateTimeSchema.optional().nullable()
});

export const TaskUpdateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["todo", "in_progress", "blocked", "done", "canceled"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  title: z.string().min(2).max(200).optional(),
  description: z.string().max(2000).optional().nullable()
});
