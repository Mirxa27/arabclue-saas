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
 *
 * RE-2: the email goes out from arabclue's own sender, and a customer decides when an
 * escalation happens, so it is fixed copy: the role (from the catalog), the channel kind and
 * the dashboard link — never the contact's name or address, the escalation reason or anything
 * else a customer or the model wrote (that stays in the dashboard). At most
 * ESCALATION_EMAILS_PER_HOUR emails per employee: the budget is claimed atomically in the
 * database (claim_owner_notification); beyond it the escalation is still recorded in the app
 * (task, conversation status, event) and `notified` is "rate_limited".
 */
import { getServiceSupabase } from "@/lib/db/supabase";
import { isPlatformEmailConfigured, platformFromAddress, sendPlatformEmail } from "@/lib/email/platform";
import { reportError } from "@/lib/observability/error-reporter";
import { getRole } from "./catalog";
import { sliceText, TASK_TITLE_MAX_CHARS } from "./text-bounds";
import type { AIConversationRow, AIEmployeeRow, TurnOrigin } from "./types";

export type EscalationNotice = "email" | "not_configured" | "no_owner_email" | "rate_limited" | "failed";

export type EscalationOutcome = {
  ok: boolean;
  taskId: string | null;
  conversationEscalated: boolean;
  notified: EscalationNotice;
  error?: string;
};

const MAX_REASON = 400;

/** Escalation emails one employee may send its owner per rolling hour (RE-2). */
export const ESCALATION_EMAILS_PER_HOUR = 10;
const EMAIL_BUDGET_WINDOW_SECONDS = 3600;

/** Fixed labels for the channel kinds a conversation can have; anything else gets the fallback. */
const CHANNEL_LABELS: Readonly<Record<string, { ar: string; en: string }>> = {
  whatsapp: { ar: "واتساب", en: "WhatsApp" },
  telegram: { ar: "تيليجرام", en: "Telegram" },
  slack: { ar: "سلاك", en: "Slack" },
  email: { ar: "البريد الإلكتروني", en: "Email" },
  gmail: { ar: "Gmail", en: "Gmail" },
  twilio_sms: { ar: "الرسائل النصية (SMS)", en: "SMS" },
  meta: { ar: "ماسنجر", en: "Messenger" },
  instagram: { ar: "إنستغرام", en: "Instagram" },
  webhook: { ar: "Webhook", en: "Webhook" },
  dashboard: { ar: "لوحة التحكم", en: "Dashboard" }
};
const FALLBACK_CHANNEL_LABEL = { ar: "قناة مراسلة", en: "Messaging channel" };

function clip(value: string | undefined | null, n: number): string {
  return sliceText((value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim(), n);
}

export function channelLabel(channel: string | null | undefined): { ar: string; en: string } {
  return (channel && Object.hasOwn(CHANNEL_LABELS, channel) ? CHANNEL_LABELS[channel] : undefined) ?? FALLBACK_CHANNEL_LABEL;
}

/**
 * The owner email for an escalation — fixed copy only (RE-2). The employee's role comes from
 * the catalog and the link from NEXT_PUBLIC_SITE_URL + the employee id; nothing a customer, the
 * model or a channel provider supplied is included.
 */
export function escalationEmail(
  emp: Pick<AIEmployeeRow, "id" | "role_id">,
  channel: string | null | undefined
): { subject: string; text: string } {
  const role = getRole(emp.role_id);
  const who = role
    ? { ar: `موظفك الذكي (${role.arabicName})`, en: `Your AI employee (${role.name})` }
    : { ar: "موظفك الذكي", en: "Your AI employee" };
  const label = channelLabel(channel);
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  const link = site && /^https?:\/\//i.test(site) ? `${site}/employees/${emp.id}` : null;
  const text = [
    `حوّل إليك ${who.ar} محادثة، وهي بانتظار ردّك.`,
    `القناة: ${label.ar}`,
    link ? `افتحها من لوحة التحكم: ${link}` : "افتحها من صفحة الموظفين الأذكياء في لوحة تحكم arabclue.",
    "لا يتضمن هذا البريد رسائل العميل؛ تجدها في لوحة التحكم فقط.",
    "",
    `${who.en} handed a conversation over to you. It is waiting for your reply.`,
    `Channel: ${label.en}`,
    link ? `Open it in your dashboard: ${link}` : "Open it from the AI employees page of your arabclue dashboard.",
    "This email never includes the customer's messages; read them in your dashboard.",
    "",
    "— arabclue"
  ].join("\n");
  return { subject: "محادثة بانتظار ردّك | A conversation is waiting for your reply", text };
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

/** Take one of the employee's hourly escalation emails; the claim's action id, or null when spent. */
async function claimEmailBudget(emp: AIEmployeeRow, taskId: string): Promise<{ id: number } | "spent" | "error"> {
  const sb = getServiceSupabase();
  const { data, error } = await sb.rpc("claim_owner_notification", {
    p_employee_id: emp.id,
    p_channel: "email",
    p_limit: ESCALATION_EMAILS_PER_HOUR,
    p_window_seconds: EMAIL_BUDGET_WINDOW_SECONDS,
    p_payload: { kind: "escalation", task_id: taskId }
  });
  if (error) {
    reportError(new Error(`claim_owner_notification: ${error.message}`), { merchantId: emp.merchant_id, extra: { employeeId: emp.id } });
    return "error";
  }
  if (data === null || data === undefined) return "spent";
  const id = Number(data);
  return Number.isSafeInteger(id) ? { id } : "error";
}

async function settleClaim(claimId: number, outcome: "success" | "failure", result: Record<string, unknown>): Promise<void> {
  const { error } = await getServiceSupabase().from("ai_employee_actions").update({ status: outcome, result }).eq("id", claimId);
  if (error) reportError(new Error(`owner_notification ${claimId}: ${error.message}`), { extra: { step: "escalation_email_settle" } });
}

async function notifyOwner(emp: AIEmployeeRow, conversation: AIConversationRow | null, taskId: string): Promise<EscalationNotice> {
  if (!isPlatformEmailConfigured()) return "not_configured";
  const to = await ownerEmail(emp.merchant_id);
  if (!to) return "no_owner_email";
  const claim = await claimEmailBudget(emp, taskId);
  if (claim === "spent") return "rate_limited";
  if (claim === "error") return "failed";

  const message = escalationEmail(emp, conversation?.channel ?? "dashboard");
  try {
    const sent = await sendPlatformEmail({ from: platformFromAddress() }, { to, ...message });
    await settleClaim(claim.id, "success", { email_id: sent.id || null, task_id: taskId });
    return "email";
  } catch (err) {
    reportError(err, { merchantId: emp.merchant_id, extra: { step: "escalation_email", employeeId: emp.id } });
    await settleClaim(claim.id, "failure", { error: "send failed", task_id: taskId });
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
      title: sliceText(`Escalation: ${reason}`, TASK_TITLE_MAX_CHARS),
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

  const notified = await notifyOwner(emp, conversation, taskId);
  await sb
    .from("ai_employee_tasks")
    .update({ result: { notified, conversation_escalated: conversationEscalated } })
    .eq("id", taskId);

  const ok = !customerThread || conversationEscalated;
  return { ok, taskId, conversationEscalated, notified, ...(ok ? {} : { error: "could not hand the conversation over" }) };
}
