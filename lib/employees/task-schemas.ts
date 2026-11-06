import { z } from "zod";
import { TASK_DESCRIPTION_MAX_CHARS, TASK_TITLE_MAX_CHARS } from "./text-bounds";

/**
 * ISO-8601 UTC timestamp, with or without seconds ("2026-11-05T12:00Z" or
 * "2026-11-05T12:00:00.000Z"). zod 4's `z.iso.datetime()` requires seconds;
 * the union keeps the minute-precision form zod 3 accepted.
 */
export const IsoDateTimeSchema = z.union([z.iso.datetime(), z.iso.datetime({ precision: -1 })]);

// The ai_employee_tasks title / description bounds (20261106009000); PostgreSQL text cannot hold NUL.
const storable = (v: string) => !v.includes("\u0000");
const TitleSchema = z.string().min(2).max(TASK_TITLE_MAX_CHARS).refine(storable, "must not contain NUL characters");
const DescriptionSchema = z.string().max(TASK_DESCRIPTION_MAX_CHARS).refine(storable, "must not contain NUL characters");

/**
 * `assignee`: "agent" — the 24/7 tick tries to complete it with one concrete action (and hands
 * it back to you when it cannot); "human" — a to-do for the merchant that the tick never touches.
 */
export const TaskCreateSchema = z.object({
  title: TitleSchema,
  description: DescriptionSchema.optional().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  due_at: IsoDateTimeSchema.optional().nullable(),
  assignee: z.enum(["agent", "human"]).default("agent")
});

export const TaskUpdateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["todo", "in_progress", "blocked", "done", "canceled"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  title: TitleSchema.optional(),
  description: DescriptionSchema.optional().nullable(),
  assignee: z.enum(["agent", "human"]).optional()
});
