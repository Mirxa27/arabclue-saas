/**
 * AI Employee runtime.
 *
 * Two entry points:
 *   • respond()           — called from the dashboard chat or a channel webhook;
 *                            produces an assistant reply for a single conversation.
 *   • tick()              — called by the 24/7 cron; advances task queue,
 *                            sends scheduled messages, logs the heartbeat.
 *
 * Both go through the same memory model: a conversation is a series of
 * AIMessageRow records. We keep the working context small (the last ~20 turns)
 * and prepend the role's system prompt + employee customisations + merchant
 * brand context.
 */

import { aiText } from "@/lib/ai/providers";
import { getServiceSupabase } from "@/lib/db/supabase";
import { getRole } from "./catalog";
import type {
  AIConversationRow,
  AIEmployeeIntegrationRow,
  AIEmployeeRow,
  AIMessageRow,
  AITaskRow,
  EmployeeHeartbeat,
  IntegrationKind
} from "./types";
import { decryptIntegrationCredentials } from "./credentials";
import { sendWhatsAppText, type WhatsAppCredentials } from "./channels/whatsapp";
import { sendTelegramText, type TelegramCredentials } from "./channels/telegram";
import { sendSlackMessage, type SlackCredentials } from "./channels/slack";
import { sendEmail, type EmailCredentials, type EmailMessage } from "./channels/email";

const MAX_CONTEXT_TURNS = 20;

// ─── Memory ────────────────────────────────────────────────────────────────

export async function loadEmployee(employeeId: string): Promise<AIEmployeeRow | null> {
  const sb = getServiceSupabase();
  const { data, error } = await sb.from("ai_employees").select("*").eq("id", employeeId).single();
  if (error || !data) return null;
  return data as AIEmployeeRow;
}

export async function loadIntegrations(employeeId: string): Promise<AIEmployeeIntegrationRow[]> {
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("ai_employee_integrations")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("status", "connected");
  return ((data ?? []) as AIEmployeeIntegrationRow[]).map((row) => ({
    ...row,
    credentials: decryptIntegrationCredentials(row.credentials)
  }));
}

export async function loadConversation(conversationId: string): Promise<{
  conv: AIConversationRow | null;
  messages: AIMessageRow[];
}> {
  const sb = getServiceSupabase();
  const [c, m] = await Promise.all([
    sb.from("ai_employee_conversations").select("*").eq("id", conversationId).single(),
    sb
      .from("ai_employee_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(MAX_CONTEXT_TURNS)
  ]);
  return {
    conv: (c.data ?? null) as AIConversationRow | null,
    messages: (((m.data ?? []) as AIMessageRow[]).slice().reverse())
  };
}

/** Find-or-create a conversation for an inbound webhook. */
export async function upsertConversation(args: {
  employeeId: string;
  channel: string;
  externalId: string;
  contactName?: string;
  contactHandle?: string;
}): Promise<AIConversationRow> {
  const sb = getServiceSupabase();
  const { data: existing } = await sb
    .from("ai_employee_conversations")
    .select("*")
    .eq("employee_id", args.employeeId)
    .eq("channel", args.channel)
    .eq("external_id", args.externalId)
    .maybeSingle();
  if (existing) return existing as AIConversationRow;

  const { data: created, error } = await sb
    .from("ai_employee_conversations")
    .insert({
      employee_id: args.employeeId,
      channel: args.channel,
      external_id: args.externalId,
      contact_name: args.contactName ?? null,
      contact_handle: args.contactHandle ?? null,
      status: "open",
      last_message_at: new Date().toISOString()
    })
    .select("*")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Failed to create conversation");
  return created as AIConversationRow;
}

async function persistMessage(args: {
  conversationId: string;
  role: AIMessageRow["role"];
  content: string;
  tokens?: number;
  latencyMs?: number;
  toolName?: string;
  toolPayload?: Record<string, unknown>;
}): Promise<AIMessageRow> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("ai_employee_messages")
    .insert({
      conversation_id: args.conversationId,
      role: args.role,
      content: args.content,
      tokens: args.tokens ?? null,
      latency_ms: args.latencyMs ?? null,
      tool_name: args.toolName ?? null,
      tool_payload: args.toolPayload ?? null
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to save message");
  await sb
    .from("ai_employee_conversations")
    .update({
      last_message_at: new Date().toISOString(),
      unread_count: args.role === "user" ? undefined : 0
    })
    .eq("id", args.conversationId);
  return data as AIMessageRow;
}

async function logAction(args: {
  employeeId: string;
  action: string;
  channel?: string;
  target?: string;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  status: "success" | "failure" | "retry";
}): Promise<void> {
  const sb = getServiceSupabase();
  await sb.from("ai_employee_actions").insert({
    employee_id: args.employeeId,
    action: args.action,
    channel: args.channel ?? null,
    target: args.target ?? null,
    payload: args.payload ?? null,
    result: args.result ?? null,
    status: args.status
  });
}

// ─── System prompt assembly ──────────────────────────────────────────────

function isWithinWorkingHours(emp: AIEmployeeRow, now = new Date()): boolean {
  const wh = emp.working_hours;
  if (!wh || wh.mode === "always") return true;
  const day = now.getUTCDay(); // 0-6
  if (!wh.days.includes(day)) return false;
  const hhmm = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  return hhmm >= wh.start && hhmm <= wh.end;
}

function buildSystemPrompt(emp: AIEmployeeRow, integrations: AIEmployeeIntegrationRow[]): string {
  const role = getRole(emp.role_id);
  if (!role) {
    return `You are ${emp.display_name}. Be helpful, accurate, and brief.`;
  }

  const connected = integrations.map((i) => i.kind).join(", ") || "none";
  const goals = (emp.goals ?? []).join("; ");
  const knowledge = emp.knowledge ?? "(none provided)";

  const cfg = (emp.config ?? {}) as Record<string, unknown>;
  const personaLines: string[] = [];
  if (cfg.persona_name) {
    personaLines.push(
      `You are ${String(cfg.persona_name)}${
        cfg.persona_arabic_name ? ` (${String(cfg.persona_arabic_name)})` : ""
      }, age ${String(cfg.persona_age ?? "—")}, ${String(cfg.persona_nationality ?? "")}, based in ${String(
        cfg.persona_city ?? ""
      )}.`
    );
    if (cfg.persona_background) personaLines.push(String(cfg.persona_background));
    if (cfg.persona_dialect)
      personaLines.push(
        `Speak in ${String(cfg.persona_dialect)} Arabic when in Arabic. Voice profile: ${String(
          cfg.persona_voice ?? "neutral"
        )}.`
      );
    if (cfg.persona_signature)
      personaLines.push(`Sign off conversational messages with: "${String(cfg.persona_signature)}"`);
  } else {
    personaLines.push(`Your name is "${emp.display_name}". You work at the merchant's business.`);
  }

  return [
    role.systemPrompt,
    ``,
    `# Identity`,
    ...personaLines,
    `Tone: ${emp.tone}. Default language: ${emp.language}. Timezone: ${emp.timezone}.`,
    ``,
    `# Connected tools`,
    `You have these integrations available: ${connected}.`,
    `Use the tool that matches the channel. Always confirm before destructive actions (refunds, sending bulk messages, cancelling bookings).`,
    ``,
    `# Goals`,
    goals || "(no goals set)",
    ``,
    `# Merchant knowledge base`,
    knowledge,
    ``,
    `# Rules`,
    `- Keep replies under 4 sentences unless the user asks for detail.`,
    `- Never invent facts, prices, stock, or policies — say "let me check" and create a task instead.`,
    `- For Saudi customers, default to Khaliji Arabic. Switch to MSA on request. Switch to English if the customer writes in English.`,
    `- Stay strictly within your role's responsibilities.`,
    `- Stay in character — never reveal you are an AI unless directly and sincerely asked.`
  ].join("\n");
}

// ─── Public API: respond ────────────────────────────────────────────────

export type RespondInput = {
  employeeId: string;
  conversationId: string;
  userMessage: string;
};

export type RespondResult = {
  reply: string;
  messageId: string;
  latencyMs: number;
};

export async function respond(input: RespondInput): Promise<RespondResult> {
  const t0 = Date.now();
  const emp = await loadEmployee(input.employeeId);
  if (!emp) throw new Error("Employee not found");
  if (emp.status !== "active") {
    return {
      reply:
        emp.language.startsWith("ar")
          ? `أنا ${emp.display_name}، حاليًا غير متاح. سأرجع قريبًا.`
          : `I'm ${emp.display_name}, currently offline. I'll be back soon.`,
      messageId: "",
      latencyMs: 0
    };
  }

  const integrations = await loadIntegrations(input.employeeId);
  const { messages } = await loadConversation(input.conversationId);

  // Persist the user message first.
  await persistMessage({
    conversationId: input.conversationId,
    role: "user",
    content: input.userMessage
  });

  const system = buildSystemPrompt(emp, integrations);
  const transcript = messages
    .map((m) => `${m.role === "user" ? "User" : m.role === "assistant" ? "You" : m.role}: ${m.content}`)
    .join("\n");

  // ── Tool router: decide if a real action is needed, then execute it ──────
  let toolNote = "";
  try {
    const { decideTool, executeTool } = await import("./tools");
    const decision = await decideTool({
      systemPrompt: system,
      transcript,
      userMessage: input.userMessage,
      availableChannels: integrations.map((i) => i.kind)
    });
    if (decision.use_tool && decision.tool !== "none") {
      const result = await executeTool({ employee: emp, integrations, decision });
      await persistMessage({
        conversationId: input.conversationId,
        role: "tool",
        content: JSON.stringify({ decision, result }),
        toolName: decision.tool,
        toolPayload: { result }
      });
      await logAction({
        employeeId: emp.id,
        action: `tool:${decision.tool}`,
        status: result.ok ? "success" : "failure",
        payload: { decision },
        result: result.output ?? (result.error ? { error: result.error } : undefined)
      });
      toolNote = result.ok
        ? `\n[Tool ${decision.tool} succeeded: ${JSON.stringify(result.output ?? {})}]`
        : `\n[Tool ${decision.tool} failed: ${result.error}]`;
    }
  } catch (err) {
    await logAction({
      employeeId: emp.id,
      action: "tool:route",
      status: "failure",
      result: { error: err instanceof Error ? err.message : String(err) }
    });
  }

  const prompt = `${transcript}\nUser: ${input.userMessage}${toolNote}\nYou:`;

  let reply = "";
  try {
    reply = (
      await aiText({
        system,
        prompt,
        temperature: emp.tone === "playful" ? 0.85 : emp.tone === "friendly" ? 0.7 : 0.45,
        maxTokens: 600
      })
    ).trim();
  } catch (err) {
    reply =
      emp.language.startsWith("ar")
        ? "اعتذر، حدث خلل تقني مؤقت. حاول مرة ثانية بعد لحظات."
        : "Sorry — a temporary glitch. Please try again in a moment.";
    await logAction({
      employeeId: emp.id,
      action: "respond",
      status: "failure",
      result: { error: err instanceof Error ? err.message : String(err) }
    });
  }

  const latencyMs = Date.now() - t0;
  const saved = await persistMessage({
    conversationId: input.conversationId,
    role: "assistant",
    content: reply,
    latencyMs
  });

  await logAction({
    employeeId: emp.id,
    action: "respond",
    status: "success",
    payload: { conversationId: input.conversationId },
    result: { latencyMs }
  });

  return { reply, messageId: saved.id, latencyMs };
}

// ─── Channel dispatch (used by webhooks + scheduled sends) ───────────────

export async function sendOnChannel(args: {
  employeeId: string;
  kind: IntegrationKind;
  to: string;
  body: string;
  subject?: string;
}): Promise<{ remoteId: string }> {
  const integrations = await loadIntegrations(args.employeeId);
  const integration = integrations.find((i) => i.kind === args.kind);
  if (!integration) throw new Error(`Integration ${args.kind} not connected`);

  switch (args.kind) {
    case "whatsapp": {
      const creds = integration.credentials as unknown as WhatsAppCredentials;
      const res = await sendWhatsAppText(creds, args.to, args.body);
      await logAction({
        employeeId: args.employeeId,
        action: "send_message",
        channel: "whatsapp",
        target: args.to,
        payload: { body: args.body.slice(0, 200) },
        result: { remoteId: res.remoteId },
        status: "success"
      });
      return res;
    }
    case "telegram": {
      const creds = integration.credentials as unknown as TelegramCredentials;
      const res = await sendTelegramText(creds, args.to, args.body);
      await logAction({
        employeeId: args.employeeId,
        action: "send_message",
        channel: "telegram",
        target: args.to,
        payload: { body: args.body.slice(0, 200) },
        result: { remoteId: String(res.remoteId) },
        status: "success"
      });
      return { remoteId: String(res.remoteId) };
    }
    case "slack": {
      const creds = integration.credentials as unknown as SlackCredentials;
      const channel = args.to || creds.default_channel || "#general";
      const res = await sendSlackMessage(creds, channel, args.body);
      await logAction({
        employeeId: args.employeeId,
        action: "send_message",
        channel: "slack",
        target: channel,
        payload: { body: args.body.slice(0, 200) },
        result: { ts: res.ts },
        status: "success"
      });
      return { remoteId: res.ts };
    }
    case "email":
    case "gmail": {
      const creds = integration.credentials as unknown as EmailCredentials;
      const msg: EmailMessage = {
        to: args.to,
        subject: args.subject ?? "Message from your team",
        text: args.body
      };
      const res = await sendEmail(creds, msg);
      await logAction({
        employeeId: args.employeeId,
        action: "send_message",
        channel: args.kind,
        target: args.to,
        payload: { subject: msg.subject, body: args.body.slice(0, 200) },
        result: { id: res.id },
        status: "success"
      });
      return { remoteId: res.id };
    }
    default:
      throw new Error(`Channel ${args.kind} send not implemented in this build`);
  }
}

// ─── 24/7 tick: advance tasks + send greetings ────────────────────────────

export async function tick(employeeId: string): Promise<{ tasksAdvanced: number; heartbeat: EmployeeHeartbeat }> {
  const sb = getServiceSupabase();
  const emp = await loadEmployee(employeeId);
  if (!emp) throw new Error("Employee not found");

  const now = new Date();
  if (emp.status !== "active") {
    const beat = await writeHeartbeat(employeeId, false);
    return { tasksAdvanced: 0, heartbeat: beat };
  }

  // Find due tasks owned by this employee
  const { data: tasksData } = await sb
    .from("ai_employee_tasks")
    .select("*")
    .eq("employee_id", employeeId)
    .in("status", ["todo", "in_progress"])
    .lte("due_at", now.toISOString())
    .order("priority", { ascending: false })
    .limit(5);

  const tasks = (tasksData ?? []) as AITaskRow[];
  let advanced = 0;

  for (const task of tasks) {
    try {
      await sb
        .from("ai_employee_tasks")
        .update({ status: "in_progress", started_at: now.toISOString() })
        .eq("id", task.id);

      // Ask the AI what to do for this task.
      const integrations = await loadIntegrations(employeeId);
      const system = buildSystemPrompt(emp, integrations);
      const prompt = [
        `Task: ${task.title}`,
        task.description ? `Details: ${task.description}` : "",
        `Priority: ${task.priority}`,
        `Decide the single best action to advance this task now. Be specific and concrete in one paragraph.`
      ].join("\n");

      const decision = await aiText({ system, prompt, temperature: 0.4, maxTokens: 400 });

      await sb
        .from("ai_employee_tasks")
        .update({
          status: "done",
          completed_at: new Date().toISOString(),
          result: { summary: decision }
        })
        .eq("id", task.id);

      await logAction({
        employeeId,
        action: "complete_task",
        payload: { taskId: task.id, title: task.title },
        result: { summary: decision.slice(0, 400) },
        status: "success"
      });
      advanced += 1;
    } catch (err) {
      await sb
        .from("ai_employee_tasks")
        .update({ status: "blocked", result: { error: err instanceof Error ? err.message : String(err) } })
        .eq("id", task.id);
      await logAction({
        employeeId,
        action: "complete_task",
        payload: { taskId: task.id },
        result: { error: err instanceof Error ? err.message : String(err) },
        status: "failure"
      });
    }
  }

  const beat = await writeHeartbeat(employeeId, isWithinWorkingHours(emp, now), advanced);
  return { tasksAdvanced: advanced, heartbeat: beat };
}

async function writeHeartbeat(
  employeeId: string,
  active: boolean,
  tasksAdvanced = 0
): Promise<EmployeeHeartbeat> {
  const sb = getServiceSupabase();
  const now = new Date().toISOString();

  const { data: existing } = await sb
    .from("ai_employee_heartbeats")
    .select("*")
    .eq("employee_id", employeeId)
    .maybeSingle();

  if (!existing) {
    const row = {
      employee_id: employeeId,
      last_tick_at: now,
      last_active_at: active ? now : now,
      tasks_completed_24h: tasksAdvanced,
      messages_handled_24h: 0,
      uptime_pct: 100.0
    };
    await sb.from("ai_employee_heartbeats").insert(row);
    return row as EmployeeHeartbeat;
  }

  const next: EmployeeHeartbeat = {
    employee_id: employeeId,
    last_tick_at: now,
    last_active_at: active ? now : (existing as EmployeeHeartbeat).last_active_at,
    tasks_completed_24h: ((existing as EmployeeHeartbeat).tasks_completed_24h ?? 0) + tasksAdvanced,
    messages_handled_24h: (existing as EmployeeHeartbeat).messages_handled_24h ?? 0,
    uptime_pct: 100.0
  };
  await sb.from("ai_employee_heartbeats").update(next).eq("employee_id", employeeId);
  return next;
}

// ─── Webhook helper: handle an inbound message end-to-end ────────────────

export async function handleInboundMessage(args: {
  employeeId: string;
  channel: IntegrationKind;
  externalId: string;
  text: string;
  contactName?: string;
}): Promise<RespondResult> {
  const conv = await upsertConversation({
    employeeId: args.employeeId,
    channel: args.channel,
    externalId: args.externalId,
    contactName: args.contactName
  });

  const result = await respond({
    employeeId: args.employeeId,
    conversationId: conv.id,
    userMessage: args.text
  });

  // Send the reply back on the originating channel
  try {
    await sendOnChannel({
      employeeId: args.employeeId,
      kind: args.channel,
      to: args.externalId,
      body: result.reply
    });
  } catch (err) {
    await logAction({
      employeeId: args.employeeId,
      action: "send_message",
      channel: args.channel,
      target: args.externalId,
      result: { error: err instanceof Error ? err.message : String(err) },
      status: "failure"
    });
  }

  return result;
}

export { logAction, persistMessage };
