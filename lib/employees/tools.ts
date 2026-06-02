/**
 * Tool execution for AI employees.
 *
 * Tools are real, side-effecting actions an employee can take. The LLM emits a
 * structured tool decision; we execute it and feed the result back into the
 * conversation as a tool message before generating the final reply.
 *
 * We keep this layer deliberately small and explicit — better one tool that
 * works than ten that hallucinate.
 */

import { z } from "zod";
import { aiStructured } from "@/lib/ai/providers";
import { getServiceSupabase } from "@/lib/db/supabase";
import type {
  AIEmployeeIntegrationRow,
  AIEmployeeRow,
  IntegrationKind
} from "./types";
import { dispatchChannelSend, MESSAGING_CHANNELS } from "./channels/dispatch";

// ─── tool schema ───────────────────────────────────────────────────────────

export const ToolDecisionSchema = z.object({
  use_tool: z.boolean(),
  tool: z
    .enum([
      "none",
      "create_task",
      "send_message",
      "schedule_followup",
      "create_calendar_event",
      "lookup_salla_order",
      "create_invoice",
      "escalate_to_human"
    ])
    .default("none"),
  reasoning: z.string().max(400).default(""),
  // Tool-specific args (any of these may be present)
  task_title: z.string().max(200).optional(),
  task_description: z.string().max(1000).optional(),
  task_priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  task_due_in_hours: z.number().int().min(1).max(720).optional(),
  channel: z.enum(MESSAGING_CHANNELS).optional(),
  to: z.string().max(200).optional(),
  subject: z.string().max(200).optional(),
  body: z.string().max(4000).optional(),
  followup_in_minutes: z.number().int().min(5).max(43_200).optional(),
  calendar_summary: z.string().max(200).optional(),
  calendar_start: z.string().optional(),    // ISO
  calendar_end: z.string().optional(),      // ISO
  calendar_attendees: z.array(z.string().email()).max(20).optional(),
  salla_order_id: z.string().max(64).optional(),
  invoice_total: z.number().positive().optional(),
  invoice_buyer_phone: z.string().max(32).optional(),
  human_reason: z.string().max(400).optional()
});
export type ToolDecision = z.infer<typeof ToolDecisionSchema>;

export type ToolExecutionResult = {
  ok: boolean;
  tool: ToolDecision["tool"];
  output?: Record<string, unknown>;
  error?: string;
};

// ─── decide ────────────────────────────────────────────────────────────────

/**
 * Ask the model whether and which tool to invoke for this user turn.
 * Cheap on tokens — we use a small schema and a focused system prompt.
 */
export async function decideTool(args: {
  systemPrompt: string;
  transcript: string;
  userMessage: string;
  availableChannels: IntegrationKind[];
}): Promise<ToolDecision> {
  const guidance = [
    `You are deciding whether the employee should take an action right now.`,
    `Available channels for outbound messages: ${args.availableChannels.join(", ") || "none"}.`,
    `Only set use_tool=true when an explicit, concrete action is justified by the user's message.`,
    `If the user is just chatting or asking a question, set use_tool=false and let the assistant reply.`
  ].join(" ");

  return aiStructured(ToolDecisionSchema, {
    system: `${args.systemPrompt}\n\n# Tool router\n${guidance}`,
    prompt: `${args.transcript}\nUser: ${args.userMessage}\nDecide:`,
    temperature: 0.1,
    maxTokens: 500
  });
}

// ─── execute ───────────────────────────────────────────────────────────────

export async function executeTool(args: {
  employee: AIEmployeeRow;
  integrations: AIEmployeeIntegrationRow[];
  decision: ToolDecision;
}): Promise<ToolExecutionResult> {
  const { employee, integrations, decision } = args;
  if (!decision.use_tool || decision.tool === "none") {
    return { ok: true, tool: "none" };
  }

  try {
    switch (decision.tool) {
      case "create_task":
        return await execCreateTask(employee, decision);
      case "send_message":
        return await execSendMessage(employee, integrations, decision);
      case "schedule_followup":
        return await execScheduleFollowup(employee, decision);
      case "create_calendar_event":
        return await execCreateCalendarEvent(employee, integrations, decision);
      case "lookup_salla_order":
        return await execLookupSallaOrder(employee, integrations, decision);
      case "create_invoice":
        return await execCreateInvoice(employee, decision);
      case "escalate_to_human":
        return await execEscalateToHuman(employee, decision);
      default:
        return { ok: false, tool: decision.tool, error: "Unknown tool" };
    }
  } catch (err) {
    return {
      ok: false,
      tool: decision.tool,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

// ─── individual tool implementations ───────────────────────────────────────

async function execCreateTask(emp: AIEmployeeRow, d: ToolDecision): Promise<ToolExecutionResult> {
  if (!d.task_title) return { ok: false, tool: "create_task", error: "task_title required" };
  const sb = getServiceSupabase();
  const dueAt = d.task_due_in_hours
    ? new Date(Date.now() + d.task_due_in_hours * 3600_000).toISOString()
    : null;
  const { data, error } = await sb
    .from("ai_employee_tasks")
    .insert({
      employee_id: emp.id,
      title: d.task_title,
      description: d.task_description ?? null,
      priority: d.task_priority ?? "normal",
      due_at: dueAt,
      source: "autonomous",
      status: "todo"
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, tool: "create_task", error: error?.message ?? "insert failed" };
  return { ok: true, tool: "create_task", output: { task_id: data.id, due_at: dueAt } };
}

async function execSendMessage(
  emp: AIEmployeeRow,
  integrations: AIEmployeeIntegrationRow[],
  d: ToolDecision
): Promise<ToolExecutionResult> {
  if (!d.channel || !d.to || !d.body) {
    return { ok: false, tool: "send_message", error: "channel, to and body are required" };
  }
  const integ = integrations.find((i) => i.kind === d.channel);
  if (!integ) {
    return { ok: false, tool: "send_message", error: `${d.channel} not connected` };
  }
  const { remoteId } = await dispatchChannelSend({
    kind: d.channel,
    credentials: integ.credentials ?? {},
    to: d.to,
    body: d.body,
    subject: d.subject
  });
  return { ok: true, tool: "send_message", output: { remote_id: remoteId } };
}

async function execScheduleFollowup(
  emp: AIEmployeeRow,
  d: ToolDecision
): Promise<ToolExecutionResult> {
  const minutes = d.followup_in_minutes ?? 60;
  const dueAt = new Date(Date.now() + minutes * 60_000).toISOString();
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("ai_employee_tasks")
    .insert({
      employee_id: emp.id,
      title: `Follow up with ${d.to ?? "contact"}`,
      description: d.body ?? null,
      priority: "normal",
      due_at: dueAt,
      source: "autonomous",
      status: "todo"
    })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, tool: "schedule_followup", error: error?.message ?? "insert failed" };
  }
  return { ok: true, tool: "schedule_followup", output: { task_id: data.id, due_at: dueAt } };
}

async function execCreateCalendarEvent(
  emp: AIEmployeeRow,
  integrations: AIEmployeeIntegrationRow[],
  d: ToolDecision
): Promise<ToolExecutionResult> {
  const integ = integrations.find((i) => i.kind === "gcal");
  if (!integ) return { ok: false, tool: "create_calendar_event", error: "Google Calendar not connected" };
  if (!d.calendar_summary || !d.calendar_start || !d.calendar_end) {
    return { ok: false, tool: "create_calendar_event", error: "summary, start, end required" };
  }
  const accessToken = (integ.credentials as { access_token?: string }).access_token;
  if (!accessToken) return { ok: false, tool: "create_calendar_event", error: "no access_token" };

  const body = {
    summary: d.calendar_summary,
    start: { dateTime: d.calendar_start, timeZone: emp.timezone },
    end: { dateTime: d.calendar_end, timeZone: emp.timezone },
    attendees: (d.calendar_attendees ?? []).map((email) => ({ email })),
    description: d.body ?? undefined
  };

  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const j = (await res.json().catch(() => ({}))) as { id?: string; htmlLink?: string; error?: { message?: string } };
  if (!res.ok) return { ok: false, tool: "create_calendar_event", error: j.error?.message ?? res.statusText };
  return { ok: true, tool: "create_calendar_event", output: { event_id: j.id, html_link: j.htmlLink } };
}

async function execLookupSallaOrder(
  emp: AIEmployeeRow,
  integrations: AIEmployeeIntegrationRow[],
  d: ToolDecision
): Promise<ToolExecutionResult> {
  if (!d.salla_order_id) return { ok: false, tool: "lookup_salla_order", error: "salla_order_id required" };

  // The merchant-level Salla token lives on the merchants table; the employee
  // shares that connection rather than holding its own.
  const sb = getServiceSupabase();
  const { data: merchant } = await sb
    .from("merchants")
    .select("access_token, store_url")
    .eq("id", emp.merchant_id)
    .maybeSingle();
  const token = (merchant as { access_token?: string } | null)?.access_token;
  if (!token) return { ok: false, tool: "lookup_salla_order", error: "Salla not connected on merchant" };

  const res = await fetch(`https://api.salla.dev/admin/v2/orders/${encodeURIComponent(d.salla_order_id)}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" }
  });
  if (!res.ok) {
    return { ok: false, tool: "lookup_salla_order", error: `Salla ${res.status}` };
  }
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: true, tool: "lookup_salla_order", output: j };
}

async function execCreateInvoice(emp: AIEmployeeRow, d: ToolDecision): Promise<ToolExecutionResult> {
  // Hands off to the existing ZATCA pipeline as a task — never issues directly
  // because the existing flow already does state-machine accounting + clearance.
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("ai_employee_tasks")
    .insert({
      employee_id: emp.id,
      title: `Issue ZATCA invoice (${d.invoice_total ?? "?"} SAR)`,
      description: `Buyer: ${d.invoice_buyer_phone ?? "?"} — drafted by the agent for owner review.`,
      priority: "high",
      due_at: new Date(Date.now() + 3600_000).toISOString(),
      source: "autonomous",
      status: "todo",
      result: { amount: d.invoice_total, buyer_phone: d.invoice_buyer_phone }
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, tool: "create_invoice", error: error?.message ?? "insert failed" };
  return { ok: true, tool: "create_invoice", output: { task_id: data.id } };
}

async function execEscalateToHuman(emp: AIEmployeeRow, d: ToolDecision): Promise<ToolExecutionResult> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("ai_employee_tasks")
    .insert({
      employee_id: emp.id,
      title: `Escalate to human: ${d.human_reason ?? "needs attention"}`,
      description: d.body ?? null,
      priority: "urgent",
      due_at: new Date().toISOString(),
      source: "autonomous",
      status: "todo"
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, tool: "escalate_to_human", error: error?.message ?? "insert failed" };
  return { ok: true, tool: "escalate_to_human", output: { task_id: data.id } };
}
