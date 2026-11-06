/**
 * The recipient's own conversation (RE-4).
 *
 * A message the employee sends to someone on the merchant's behalf (a follow-up scheduled from
 * the dashboard or by one of the merchant's tasks, an immediate send_message) belongs in the
 * thread with that recipient — on the same channel, under any form of the address that thread
 * was stored with — never in the merchant's dashboard thread. The thread is created when the
 * employee has never talked to the recipient, so the merchant can see what was sent, hand the
 * thread over (human takeover) and the AI's next reply there has the history.
 */
import { getServiceSupabase } from "@/lib/db/supabase";
import type { MessagingChannel } from "./channels/dispatch";
import { conversationExternalIds, normalizeRecipient } from "./recipients";
import type { AIConversationRow } from "./types";

/** Is `conv` the thread with `to` (a normalised recipient) on `channel`? */
export function isRecipientConversation(
  conv: Pick<AIConversationRow, "channel" | "external_id"> | null | undefined,
  channel: MessagingChannel,
  to: string
): boolean {
  if (!conv || conv.channel !== channel || !conv.external_id) return false;
  return normalizeRecipient(channel, conv.external_id) === to;
}

/** This employee's existing thread with `to` on `channel`, or null. */
export async function findRecipientConversation(
  employeeId: string,
  channel: MessagingChannel,
  to: string
): Promise<AIConversationRow | null> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("ai_employee_conversations")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("channel", channel)
    .in("external_id", conversationExternalIds(channel, to))
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`Failed to look up the recipient's conversation: ${error.message}`);
  const rows = (Array.isArray(data) ? data : []) as AIConversationRow[];
  return rows.find((row) => isRecipientConversation(row, channel, to)) ?? null;
}

/** This employee's thread with `to` on `channel`, created (status open) when there is none yet. */
export async function recipientConversation(
  employeeId: string,
  channel: MessagingChannel,
  to: string
): Promise<AIConversationRow> {
  const existing = await findRecipientConversation(employeeId, channel, to);
  if (existing) return existing;

  const [externalId] = conversationExternalIds(channel, to);
  const { data, error } = await getServiceSupabase()
    .from("ai_employee_conversations")
    .insert({
      employee_id: employeeId,
      channel,
      external_id: externalId,
      status: "open",
      last_message_at: new Date().toISOString()
    })
    .select("*")
    .single();
  if (error?.code === "23505") {
    // The recipient wrote in (or another send created the thread) at the same moment.
    const raced = await findRecipientConversation(employeeId, channel, to);
    if (raced) return raced;
  }
  if (error || !data) throw new Error("Failed to create the recipient's conversation");
  return data as AIConversationRow;
}
