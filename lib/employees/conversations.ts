/**
 * The merchant's view of an employee's channel conversations (critic-17(g)):
 *   list (paginated, newest activity first), one conversation with its message history
 *   (paginated backwards), and the human-takeover switch (`escalated` ↔ `open`, plus
 *   `snoozed` / `closed`). Reads and the status update go through the merchant's RLS-scoped
 *   session; the status change is logged in the activity feed (service role).
 * Cursors are opaque base64url strings; values are validated before they reach a filter.
 */
import { z } from "zod";
import { getServerSupabase } from "@/lib/db/supabase";
import { HttpError } from "@/lib/api/errors";
import { EmployeeApiError, isUuid } from "./http";
import { logAction } from "./runtime";
import type { AIConversationRow, AIMessageRow } from "./types";

export const CONVERSATION_COLUMNS =
  "id, employee_id, channel, external_id, contact_name, contact_handle, subject, status, unread_count, last_message_at, created_at";
const MESSAGE_COLUMNS = "id, conversation_id, role, content, tool_name, created_at";

export type ConversationSummary = Pick<
  AIConversationRow,
  | "id"
  | "employee_id"
  | "channel"
  | "external_id"
  | "contact_name"
  | "contact_handle"
  | "subject"
  | "status"
  | "unread_count"
  | "last_message_at"
  | "created_at"
>;

export type ConversationMessage = Pick<AIMessageRow, "id" | "conversation_id" | "role" | "content" | "tool_name" | "created_at">;

const CONVERSATION_STATUSES = ["open", "snoozed", "escalated", "closed"] as const;

export const ConversationListQuerySchema = z.object({
  channel: z.string().trim().regex(/^[a-z_]{2,32}$/).optional(),
  status: z.enum(CONVERSATION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(300).optional()
});

export const MessagePageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().max(300).optional()
});

export const ConversationStatusSchema = z.object({ status: z.enum(CONVERSATION_STATUSES) });

// Postgres timestamptz as PostgREST returns it, e.g. 2026-11-06T07:38:45.123456+00:00.
const TS_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

type Cursor = { t: string; id: string };

function encodeCursor(t: string, id: string): string {
  return Buffer.from(JSON.stringify({ t, id }), "utf8").toString("base64url");
}

function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Cursor>;
    if (typeof v.t === "string" && TS_RE.test(v.t) && isUuid(v.id)) return { t: v.t, id: v.id };
  } catch {
    // fall through
  }
  throw new HttpError(400, "cursor is not valid", "invalid_request");
}

/** keyset "older than (t, id)" for a descending (t, id) order. */
function olderThan(column: string, c: Cursor): string {
  return `${column}.lt."${c.t}",and(${column}.eq."${c.t}",id.lt.${c.id})`;
}

export async function listConversations(
  employeeId: string,
  q: z.infer<typeof ConversationListQuerySchema>
): Promise<{ conversations: ConversationSummary[]; next_cursor: string | null }> {
  const sb = await getServerSupabase();
  let query = sb.from("ai_employee_conversations").select(CONVERSATION_COLUMNS).eq("employee_id", employeeId);
  query = q.channel ? query.eq("channel", q.channel) : query.neq("channel", "dashboard");
  if (q.status) query = query.eq("status", q.status);
  const cursor = decodeCursor(q.cursor);
  if (cursor) query = query.or(olderThan("last_message_at", cursor));
  const { data, error } = await query
    .order("last_message_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(q.limit + 1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ConversationSummary[];
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    conversations: page,
    next_cursor: rows.length > q.limit && last ? encodeCursor(last.last_message_at, last.id) : null
  };
}

const notFoundConversation = () =>
  new EmployeeApiError(404, "conversation_not_found", "That conversation was not found for this employee.");

async function ownConversation(employeeId: string, conversationId: string): Promise<ConversationSummary> {
  if (!isUuid(conversationId)) throw notFoundConversation();
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("ai_employee_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("id", conversationId)
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (error || !data) throw notFoundConversation();
  return data as ConversationSummary;
}

export async function getConversationHistory(
  employeeId: string,
  conversationId: string,
  q: z.infer<typeof MessagePageQuerySchema>
): Promise<{ conversation: ConversationSummary; messages: ConversationMessage[]; next_before: string | null }> {
  const conversation = await ownConversation(employeeId, conversationId);
  const sb = await getServerSupabase();
  let query = sb.from("ai_employee_messages").select(MESSAGE_COLUMNS).eq("conversation_id", conversation.id);
  const before = decodeCursor(q.before);
  if (before) query = query.or(olderThan("created_at", before));
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(q.limit + 1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ConversationMessage[];
  const page = rows.slice(0, q.limit);
  const oldest = page[page.length - 1];
  return {
    conversation,
    messages: page.slice().reverse(),
    next_before: rows.length > q.limit && oldest ? encodeCursor(oldest.created_at, oldest.id) : null
  };
}

export async function setConversationStatus(
  employeeId: string,
  conversationId: string,
  status: z.infer<typeof ConversationStatusSchema>["status"]
): Promise<ConversationSummary> {
  const current = await ownConversation(employeeId, conversationId);
  if (current.channel === "dashboard") {
    throw new HttpError(400, "The dashboard conversation cannot be handed over", "invalid_request");
  }
  if (current.status === status) return current;
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("ai_employee_conversations")
    .update({ status })
    .eq("id", current.id)
    .eq("employee_id", employeeId)
    .select(CONVERSATION_COLUMNS)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to update the conversation");
  await logAction({
    employeeId,
    action: "conversation_status",
    channel: current.channel,
    target: current.external_id ?? undefined,
    payload: { conversationId: current.id, from: current.status, to: status },
    status: "success"
  });
  return data as ConversationSummary;
}
