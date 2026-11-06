/**
 * Size bounds for the text an AI employee stores and hands to a model (SW-20, RE-1).
 *
 * Storage bounds (`*_MAX_CHARS`) are enforced by the database as well
 * (supabase/migrations/20261106009000_employee_bounds_repair.sql), because the owner can write
 * messages and tasks straight through the Data API. Prompt bounds (PROMPT_TEXT_LIMITS) are
 * applied when a prompt is built, so whatever is stored — however it got there — reaches the
 * model at a bounded size. Lengths are UTF-16 code units (JS `length`, zod `.max()`); a string
 * within such a bound is always within the same bound in PostgreSQL's char_length.
 * Pure and client-safe.
 */

/** ai_employee_messages.content (new messages are at most 4000: chat API and inbound channels). */
export const MESSAGE_CONTENT_MAX_CHARS = 16_000;
/** ai_employee_tasks.title — the tasks API limit. */
export const TASK_TITLE_MAX_CHARS = 200;
/** ai_employee_tasks.description — the tasks API limit. */
export const TASK_DESCRIPTION_MAX_CHARS = 2000;

/** What one prompt may carry of the conversation history and of a task. */
export const PROMPT_TEXT_LIMITS = {
  /** One transcript message as the model sees it. */
  message: 4000,
  /** The whole transcript (the newest messages are kept). */
  transcript: 24_000,
  task_title: TASK_TITLE_MAX_CHARS,
  task_description: TASK_DESCRIPTION_MAX_CHARS
} as const;

const ELLIPSIS = "…";

/** The first `max` UTF-16 code units of `text`, never ending in half a surrogate pair. */
export function sliceText(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * `text` cut to at most `max` UTF-16 code units, never between the halves of a surrogate pair.
 * A cut is marked with "…" (counted in `max`).
 */
export function truncateText(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  return sliceText(text, max - ELLIPSIS.length) + ELLIPSIS;
}
