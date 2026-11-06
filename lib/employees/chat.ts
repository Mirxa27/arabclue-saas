/**
 * Dashboard chat with an employee (POST/GET /api/employees/:id/chat).
 *
 * F15: a supplied conversation_id must be this employee's own dashboard conversation
 * (checked with the merchant's RLS-scoped session) — anything else is 404, and the runtime
 * loads conversations by (id, employee_id) as well. SW-18 / F10: an employee whose merchant
 * lacks the AI-employees plan or whose seat is unpaid answers 402; a paused one 409 — before
 * any model call.
 */
import { z } from "zod";
import { getServerSupabase } from "@/lib/db/supabase";
import type { Merchant } from "@/lib/types/database";
import { employeeRunGate, runGateError } from "./gates";
import { EmployeeApiError } from "./http";
import { ConversationNotFoundError, EmployeeNotRunnableError, respond, upsertConversation } from "./runtime";
import type { AIEmployeeRow, AIMessageRow } from "./types";

export const ChatSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversation_id: z.string().uuid().optional()
});

export type ChatInput = z.infer<typeof ChatSchema>;

const conversationNotFound = () =>
  new EmployeeApiError(404, "conversation_not_found", "That conversation was not found for this employee.");

/** This employee's dashboard conversation with the given id, through the owner's session; null if none. */
async function ownDashboardConversation(employeeId: string, conversationId: string): Promise<string | null> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("ai_employee_conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("employee_id", employeeId)
    .eq("channel", "dashboard")
    .maybeSingle();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

export async function chatWithEmployee(
  merchant: Merchant,
  employee: AIEmployeeRow,
  body: ChatInput
): Promise<{ conversation_id: string; reply: string; message_id: string; latency_ms: number }> {
  const gate = employeeRunGate(employee, merchant);
  if (!gate.ok) throw runGateError(gate, employee);

  let conversationId: string;
  if (body.conversation_id) {
    const own = await ownDashboardConversation(employee.id, body.conversation_id);
    if (!own) throw conversationNotFound();
    conversationId = own;
  } else {
    conversationId = (
      await upsertConversation({ employeeId: employee.id, channel: "dashboard", externalId: `dashboard:${employee.id}` })
    ).id;
  }

  try {
    const result = await respond({
      employeeId: employee.id,
      conversationId,
      userMessage: body.message,
      origin: "merchant"
    });
    return { conversation_id: conversationId, reply: result.reply, message_id: result.messageId, latency_ms: result.latencyMs };
  } catch (err) {
    if (err instanceof EmployeeNotRunnableError) throw runGateError({ ok: false, reason: err.reason }, employee);
    if (err instanceof ConversationNotFoundError) throw conversationNotFound();
    throw err;
  }
}

/** Transcript of one of this employee's conversations (oldest first, at most `limit`). */
export async function conversationTranscript(employeeId: string, conversationId: string, limit = 500): Promise<AIMessageRow[]> {
  const sb = await getServerSupabase();
  const { data: conv, error } = await sb
    .from("ai_employee_conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (error || !conv) throw conversationNotFound();
  const { data, error: msgErr } = await sb
    .from("ai_employee_messages")
    .select("id, conversation_id, role, content, tool_name, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (msgErr) throw new Error(msgErr.message);
  return (data ?? []) as AIMessageRow[];
}
