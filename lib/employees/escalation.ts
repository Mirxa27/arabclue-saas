/**
 * Hand a conversation to the merchant (escalate_to_human, SW-5).
 *
 * An escalation is real only when the merchant can see and act on it:
 *   1. a merchant-owned task (`assignee 'human'`, kind 'escalation', urgent) — the 24/7 tick
 *      never works it, so it stays open until the merchant closes it;
 *   2. the customer conversation moves to `escalated`: the AI stops auto-replying there
 *      (HUMAN_TAKEOVER_STATUSES) and the merchant can hand it back (PATCH …/conversations/:cid);
 *   3. an `employee.escalation` event (admin stats / audit);
 *   4. a best-effort email to the store owner from the platform sender (when platform email
 *      is configured) — the outcome is recorded on the task, never assumed.
 * `ok` is false unless 1 (and 2, for a customer conversation) succeeded, so the reply never
 * tells a customer a human was looped in when nobody was.
 */
import { getServiceSupabase } from "@/lib/db/supabase";
import { isPlatformEmailConfigured, platformFromAddress, sendPlatformEmail } from "@/lib/email/platform";
import { reportError } from "@/lib/observability/error-reporter";
import type { AIConversationRow, AIEmployeeRow, TurnOrigin } from "./types";

export type EscalationNotice = "email" | "not_configured" | "no_owner_email" | "failed";

export type EscalationOutcome = {
  ok: boolean;
  taskId: string | null;
  conversationEscalated: boolean;
  notified: EscalationNotice;
  error?: string;
};

const MAX_REASON = 400;

function clip(value: string | undefined | null, n: number): string {
  return (value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, n);
}

async function ownerEmail(merchantId: string): Promise<string | null> {
  try {
    const sb = getServiceSupabase();
    const { data: merchant } = await sb.from("merchants").select("owner_user_id").eq("id", merchantId).maybeSingle();
    const ownerId = (merchant as { owner_user_id?: string | null } | null)?.owner_user_id;
    if (!ownerId) return null;
    const { data } = await sb.auth.admin.getUserById(ownerId);
    return data?.user?.email ?? null;
  } catch {
    return null;
  }
}

async function notifyOwner(emp: AIEmployeeRow, reason: string, conversation: AIConversationRow | null): Promise<EscalationNotice> {
  if (!isPlatformEmailConfigured()) return "not_configured";
  const from = platformFromAddress();
  const to = await ownerEmail(emp.merchant_id);
  if (!to) return "no_owner_email";
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  const link = site ? `${site}/employees/${emp.id}` : null;
  const channel = conversation?.channel ?? "dashboard";
  const contact = conversation?.contact_name ?? conversation?.external_id ?? "";
  const text = [
    `${emp.display_name} حوّل محادثة إليك وتحتاج متابعتك.`,
    `القناة: ${channel}${contact ? ` — ${contact}` : ""}`,
    `السبب: ${reason}`,
    ...(link ? [`افتح المحادثة: ${link}`] : []),
    "",
    `${emp.display_name} handed a conversation to you and it needs your attention.`,
    `Channel: ${channel}${contact ? ` — ${contact}` : ""}`,
    `Reason: ${reason}`,
    ...(link ? [`Open it: ${link}`] : []),
    "",
    "— arabclue"
  ].join("\n");
  try {
    await sendPlatformEmail(
      { from },
      { to, subject: `تحويل محادثة من ${emp.display_name} | Conversation handed to you`, text }
    );
    return "email";
  } catch (err) {
    reportError(err, { merchantId: emp.merchant_id, extra: { step: "escalation_email", employeeId: emp.id } });
    return "failed";
  }
}

export async function escalateToHuman(args: {
  employee: AIEmployeeRow;
  conversation: AIConversationRow | null;
  origin: TurnOrigin;
  reason?: string | null;
  summary?: string | null;
}): Promise<EscalationOutcome> {
  const { employee: emp, conversation } = args;
  const reason = clip(args.reason, MAX_REASON) || "needs attention";
  const sb = getServiceSupabase();
  const customerThread = Boolean(conversation && conversation.channel !== "dashboard");

  const { data: task, error: taskErr } = await sb
    .from("ai_employee_tasks")
    .insert({
      employee_id: emp.id,
      title: `Escalation: ${reason}`.slice(0, 200),
      description: clip(args.summary, 1000) || null,
      priority: "urgent",
      due_at: new Date().toISOString(),
      source: "autonomous",
      status: "todo",
      assignee: "human",
      kind: "escalation",
      conversation_id: conversation?.id ?? null,
      payload: {
        origin: args.origin,
        reason,
        channel: conversation?.channel ?? "dashboard",
        contact: conversation?.external_id ?? null
      }
    })
    .select("id")
    .single();
  if (taskErr || !task) {
    return { ok: false, taskId: null, conversationEscalated: false, notified: "not_configured", error: "could not record the escalation" };
  }
  const taskId = (task as { id: string }).id;

  let conversationEscalated = false;
  if (conversation && customerThread) {
    const { error } = await sb
      .from("ai_employee_conversations")
      .update({ status: "escalated" })
      .eq("id", conversation.id)
      .eq("employee_id", emp.id);
    conversationEscalated = !error;
  }

  const { error: eventErr } = await sb.from("events").insert({
    kind: "employee.escalation",
    merchant: emp.merchant_id,
    payload: {
      employee_id: emp.id,
      task_id: taskId,
      conversation_id: conversation?.id ?? null,
      channel: conversation?.channel ?? "dashboard",
      origin: args.origin,
      reason
    }
  });
  if (eventErr) reportError(new Error(`employee.escalation event: ${eventErr.message}`), { merchantId: emp.merchant_id });

  const notified = await notifyOwner(emp, reason, conversation);
  await sb
    .from("ai_employee_tasks")
    .update({ result: { notified, conversation_escalated: conversationEscalated } })
    .eq("id", taskId);

  const ok = !customerThread || conversationEscalated;
  return { ok, taskId, conversationEscalated, notified, ...(ok ? {} : { error: "could not hand the conversation over" }) };
}
