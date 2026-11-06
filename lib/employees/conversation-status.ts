import type { AIConversationRow } from "./types";

/**
 * Conversation states in which a human owns the thread (critic-17h): inbound messages are
 * stored for the merchant, but the AI neither answers nor sends — follow-ups included (RE-4).
 */
export const HUMAN_TAKEOVER_STATUSES: ReadonlySet<AIConversationRow["status"]> = new Set([
  "escalated",
  "snoozed",
  "closed"
]);
