/** FEEDBACK-01 / UI-019 — persisted 30-day dismissal of the feedback launcher. */
import { describe, expect, it } from "vitest";
import {
  FEEDBACK_PROMPT_SNOOZE_MS,
  FEEDBACK_PROMPT_STORAGE_KEY,
  hideFeedbackPrompt,
  isFeedbackPromptHidden,
} from "@/lib/ui/feedback-prompt";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const NOW = Date.UTC(2026, 10, 6, 12);

describe("feedback launcher dismissal", () => {
  it("shows the launcher when nothing is stored", () => {
    expect(isFeedbackPromptHidden(memoryStorage(), NOW)).toBe(false);
    expect(isFeedbackPromptHidden(null, NOW)).toBe(false);
  });

  it("hides it for 30 days after a dismissal or a submission, then shows it again", () => {
    for (const reason of ["dismissed", "submitted"] as const) {
      const storage = memoryStorage();
      hideFeedbackPrompt(storage, reason, NOW);
      expect(JSON.parse(storage.data.get(FEEDBACK_PROMPT_STORAGE_KEY)!)).toEqual({ hiddenAt: NOW, reason });
      expect(isFeedbackPromptHidden(storage, NOW + 1000)).toBe(true);
      expect(isFeedbackPromptHidden(storage, NOW + FEEDBACK_PROMPT_SNOOZE_MS - 1)).toBe(true);
      expect(isFeedbackPromptHidden(storage, NOW + FEEDBACK_PROMPT_SNOOZE_MS)).toBe(false);
    }
  });

  it("treats corrupted or foreign values as not dismissed", () => {
    for (const raw of ["{", "null", "42", '{"hiddenAt":"x","reason":"dismissed"}', '{"hiddenAt":1,"reason":"other"}']) {
      expect(isFeedbackPromptHidden(memoryStorage({ [FEEDBACK_PROMPT_STORAGE_KEY]: raw }), NOW), raw).toBe(false);
    }
  });

  it("does not stay hidden forever when the stored time is in the future (clock change)", () => {
    const storage = memoryStorage();
    hideFeedbackPrompt(storage, "dismissed", NOW + 10 * FEEDBACK_PROMPT_SNOOZE_MS);
    expect(isFeedbackPromptHidden(storage, NOW)).toBe(false);
  });

  it("never throws when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(isFeedbackPromptHidden(blocked, NOW)).toBe(false);
    expect(() => hideFeedbackPrompt(blocked, "dismissed", NOW)).not.toThrow();
  });
});
