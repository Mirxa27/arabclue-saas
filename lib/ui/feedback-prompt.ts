/**
 * Persistence for the dashboard feedback launcher (FEEDBACK-01 / UI-019).
 *
 * Closing the feedback card (its X) or sending feedback hides the launcher for 30 days. Only a
 * timestamp and a reason are stored, per browser, in localStorage. Every access is guarded:
 * private mode, blocked storage or a corrupted value fall back to "show" (reads) or a no-op
 * (writes) instead of breaking the dashboard chrome.
 */

export const FEEDBACK_PROMPT_STORAGE_KEY = "arabclue:feedback-prompt";
export const FEEDBACK_PROMPT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

export type FeedbackPromptHideReason = "dismissed" | "submitted";

type StoredRecord = { hiddenAt: number; reason: FeedbackPromptHideReason };

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

function parse(raw: string | null): StoredRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredRecord> | null;
    if (!value || typeof value.hiddenAt !== "number" || !Number.isFinite(value.hiddenAt)) return null;
    if (value.reason !== "dismissed" && value.reason !== "submitted") return null;
    return { hiddenAt: value.hiddenAt, reason: value.reason };
  } catch {
    return null;
  }
}

/** True when the launcher should be hidden at `now` (a dismissal or submission < 30 days ago). */
export function isFeedbackPromptHidden(storage: ReadableStorage | null | undefined, now: number): boolean {
  if (!storage) return false;
  let raw: string | null = null;
  try {
    raw = storage.getItem(FEEDBACK_PROMPT_STORAGE_KEY);
  } catch {
    return false;
  }
  const record = parse(raw);
  if (!record) return false;
  // A timestamp in the future (clock change) does not hide the launcher forever.
  if (record.hiddenAt > now) return false;
  return now - record.hiddenAt < FEEDBACK_PROMPT_SNOOZE_MS;
}

/** Remember that the launcher was dismissed / used at `now`. Never throws. */
export function hideFeedbackPrompt(
  storage: WritableStorage | null | undefined,
  reason: FeedbackPromptHideReason,
  now: number,
): void {
  if (!storage) return;
  try {
    storage.setItem(FEEDBACK_PROMPT_STORAGE_KEY, JSON.stringify({ hiddenAt: now, reason } satisfies StoredRecord));
  } catch {
    // Storage full or blocked: the launcher just comes back on the next visit.
  }
}

/** `window.localStorage`, or null where reading the property itself throws (sandboxed frames). */
export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
