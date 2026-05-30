/**
 * Domain types for the AI Employee marketplace.
 *
 * An EmployeeRole is a hireable template (defined statically in `catalog.ts`).
 * An AIEmployee is a hired instance owned by a merchant (lives in `ai_employees`).
 */

import { z } from "zod";

export type IntegrationKind =
  // universal messaging channels
  | "whatsapp"
  | "telegram"
  | "slack"
  | "email"
  | "gmail"
  | "webhook"
  // commerce / ops
  | "salla"
  | "shopify"
  | "stripe"
  | "moyasar"
  | "zatca"
  // social platforms
  | "meta"
  | "instagram"
  | "linkedin"
  | "x"
  | "tiktok"
  | "youtube"
  // productivity
  | "gcal"
  | "outlook_calendar"
  | "notion"
  | "google_drive"
  // CRM / support
  | "hubspot"
  | "intercom"
  | "zendesk"
  // voice / phone
  | "twilio_voice"
  | "twilio_sms"
  // dev
  | "github"
  | "jira"
  // finance
  | "quickbooks"
  | "xero"
  // marketing
  | "mailchimp"
  | "google_ads"
  | "google_analytics";

export type IntegrationStatus = "connected" | "disconnected" | "error";

export type EmployeeCategory =
  | "sales"
  | "support"
  | "marketing"
  | "operations"
  | "finance"
  | "people"
  | "engineering"
  | "executive"
  | "creative"
  | "compliance";

export type EmployeeTier = "starter" | "growth" | "pro" | "scale";

export type WorkingHours = {
  mode: "always" | "business_hours" | "custom";
  start: string;   // HH:mm
  end: string;     // HH:mm
  days: number[];  // 0=Sun..6=Sat
};

export type EmployeeTool = {
  name: string;
  label: string;
  description: string;
};

/** Static, pre-built role definition. */
export interface EmployeeRole {
  id: string;
  slug: string;
  name: string;             // e.g. "Sales Development Rep"
  arabicName: string;       // e.g. "مندوب مبيعات"
  emoji: string;
  category: EmployeeCategory;
  tagline: string;
  bio: string;              // 2-4 sentences, first-person
  responsibilities: string[];
  skills: string[];
  kpis: string[];
  defaultLanguage: "ar" | "en" | "ar-en";
  defaultTone: "professional" | "friendly" | "formal" | "playful";
  channels: IntegrationKind[];          // always-on channels (always includes whatsapp + telegram)
  recommendedIntegrations: IntegrationKind[];
  tools: EmployeeTool[];
  systemPrompt: string;
  starterPriceHalalas: number;          // monthly
  growthPriceHalalas: number;
  proPriceHalalas: number;
  scalePriceHalalas: number;
  trialDays: number;
  highlight?: string;                   // "Most hired" / "New" / "Saudi-tuned"
}

export const WorkingHoursSchema = z.object({
  mode: z.enum(["always", "business_hours", "custom"]),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  days: z.array(z.number().int().min(0).max(6))
});

export type AIEmployeeRow = {
  id: string;
  merchant_id: string;
  role_id: string;
  display_name: string;
  avatar: string | null;
  language: string;
  tone: string;
  timezone: string;
  working_hours: WorkingHours;
  knowledge: string | null;
  goals: string[];
  status: "active" | "paused" | "offboarded";
  hire_plan: EmployeeTier;
  monthly_charge_halalas: number;
  billing_status: "trial" | "active" | "past_due" | "canceled";
  last_billing_payment_id: string | null;
  next_billing_at: string | null;
  trial_ends_at: string | null;
  hired_at: string;
  paused_at: string | null;
  offboarded_at: string | null;
  config: Record<string, unknown>;
};

export type AIEmployeeIntegrationRow = {
  id: string;
  employee_id: string;
  kind: IntegrationKind;
  external_id: string | null;
  /** Present on server-side rows only; never returned to clients. */
  credentials?: Record<string, unknown>;
  /** Keys configured on connect (API responses). */
  credentials_configured?: string[];
  config: Record<string, unknown>;
  status: IntegrationStatus;
  last_event_at: string | null;
  created_at: string;
};

export type AIConversationRow = {
  id: string;
  employee_id: string;
  channel: string;
  external_id: string | null;
  contact_name: string | null;
  contact_handle: string | null;
  subject: string | null;
  status: "open" | "snoozed" | "escalated" | "closed";
  unread_count: number;
  last_message_at: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AIMessageRow = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_name: string | null;
  tool_payload: Record<string, unknown> | null;
  tokens: number | null;
  latency_ms: number | null;
  created_at: string;
};

export type AITaskRow = {
  id: string;
  employee_id: string;
  title: string;
  description: string | null;
  source: "system" | "user" | "schedule" | "webhook" | "autonomous";
  due_at: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  status: "todo" | "in_progress" | "blocked" | "done" | "canceled";
  result: Record<string, unknown> | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type AIActionRow = {
  id: number;
  employee_id: string;
  action: string;
  channel: string | null;
  target: string | null;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  status: "success" | "failure" | "retry";
  created_at: string;
};

export type EmployeeHeartbeat = {
  employee_id: string;
  last_tick_at: string;
  last_active_at: string;
  tasks_completed_24h: number;
  messages_handled_24h: number;
  uptime_pct: number;
};
