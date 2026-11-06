/**
 * Dashboard notifications (UI-016): the merchant's actionable items, newest first, with an
 * unread state driven by merchant_notification_state.last_seen_at
 * (supabase/migrations/20261106007600_notifications_and_overview.sql).
 *
 * Sources (last NOTIFICATION_WINDOW_DAYS days unless noted):
 *   - escalations a human must handle: events social.escalation / voice.escalation /
 *     employee.escalation (events is service-role only; filtered to this merchant's id)
 *   - social_posts that failed to publish
 *   - ZATCA invoices rejected or failed
 *   - new voice bookings waiting for confirmation
 *   - billing problems: failed payments, a past-due subscription (while it lasts), AI employees
 *     whose billing is past due (while it lasts)
 * Every merchant-scoped table is read with the merchant's RLS-scoped session; only events use
 * the service role. Texts written by customers or AI are returned as `detail` (render with
 * dir="auto") and truncated.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoDbError } from "@/lib/db/errors";
import type { Merchant } from "@/lib/types/database";

export const NOTIFICATION_WINDOW_DAYS = 30;
export const NOTIFICATION_LIMIT = 20;
const PER_SOURCE = 10;
const DETAIL_MAX = 140;

export type NotificationKind =
  | "social_escalation"
  | "voice_escalation"
  | "employee_escalation"
  | "post_failed"
  | "invoice_problem"
  | "voice_booking"
  | "payment_failed"
  | "subscription_past_due"
  | "employee_billing_past_due";

export type NotificationItem = {
  id: string;
  kind: NotificationKind;
  at: string;
  href: string;
  title: { ar: string; en: string };
  /** Customer- or AI-authored text; render with dir="auto". */
  detail: string | null;
  unread: boolean;
};

export type NotificationFeed = {
  items: NotificationItem[];
  unread_count: number;
  last_seen_at: string | null;
};

const TITLES: Record<NotificationKind, { ar: string; en: string }> = {
  social_escalation: { ar: "عميل يحتاج رداً بشرياً على التواصل الاجتماعي", en: "A social customer needs a human reply" },
  voice_escalation: { ar: "مكالمة تحتاج متابعة بشرية", en: "A call needs human follow-up" },
  employee_escalation: { ar: "موظف ذكي صعّد محادثة إليك", en: "An AI employee escalated a conversation to you" },
  post_failed: { ar: "تعذّر نشر منشور", en: "A post failed to publish" },
  invoice_problem: { ar: "فاتورة لم تُعتمد من زاتكا", en: "An invoice was not cleared by ZATCA" },
  voice_booking: { ar: "حجز جديد من الوكيل الصوتي", en: "New booking from the voice agent" },
  payment_failed: { ar: "فشلت عملية دفع", en: "A payment failed" },
  subscription_past_due: { ar: "اشتراكك متأخر السداد", en: "Your subscription payment is past due" },
  employee_billing_past_due: { ar: "اشتراك موظف ذكي متأخر السداد", en: "An AI employee's billing is past due" }
};

function clip(value: unknown, max = DETAIL_MAX): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Draft = Omit<NotificationItem, "unread">;

type EventRow = { id: number | string; kind: string; payload: Record<string, unknown> | null; created_at: string };

function fromEvent(row: EventRow): Draft | null {
  const payload = row.payload ?? {};
  const at = row.created_at;
  switch (row.kind) {
    case "social.escalation":
      return {
        id: `event:${row.id}`,
        kind: "social_escalation",
        at,
        href: "/social",
        title: TITLES.social_escalation,
        detail: clip(payload.reason) ?? clip(payload.summary)
      };
    case "voice.escalation":
      return {
        id: `event:${row.id}`,
        kind: "voice_escalation",
        at,
        href: "/voice",
        title: TITLES.voice_escalation,
        detail: clip(payload.reason) ?? clip(payload.summary)
      };
    case "employee.escalation": {
      const employeeId = typeof payload.employee_id === "string" && UUID.test(payload.employee_id) ? payload.employee_id : null;
      return {
        id: `event:${row.id}`,
        kind: "employee_escalation",
        at,
        href: employeeId ? `/employees/${employeeId}` : "/employees",
        title: TITLES.employee_escalation,
        detail: clip(payload.reason)
      };
    }
    default:
      return null;
  }
}

export type NotificationSources = {
  merchant: Pick<Merchant, "id" | "subscription_status" | "subscription_expires_at">;
  /** The merchant's RLS-scoped session. */
  userClient: SupabaseClient;
  /** Service role — events only. */
  serviceClient: SupabaseClient;
  now?: Date;
};

/** Load and merge every source, newest first, capped at NOTIFICATION_LIMIT, with unread flags. */
export async function loadNotifications(src: NotificationSources): Promise<NotificationFeed> {
  const { merchant } = src;
  const now = src.now ?? new Date();
  const since = new Date(now.getTime() - NOTIFICATION_WINDOW_DAYS * 86_400_000).toISOString();
  const ctx = { route: "GET /api/notifications", merchantId: merchant.id, code: "db_read_failed" };

  const [state, events, posts, invoices, bookings, payments, employees] = await Promise.all([
    src.userClient.from("merchant_notification_state").select("last_seen_at").eq("merchant_id", merchant.id).maybeSingle(),
    src.serviceClient
      .from("events")
      .select("id, kind, payload, created_at")
      .eq("merchant", merchant.id)
      .in("kind", ["social.escalation", "voice.escalation", "employee.escalation"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
    src.userClient
      .from("social_posts")
      .select("id, hook, scheduled_for")
      .eq("merchant_id", merchant.id)
      .eq("status", "failed")
      .gte("scheduled_for", since)
      .order("scheduled_for", { ascending: false })
      .limit(PER_SOURCE),
    src.userClient
      .from("invoices")
      .select("id, invoice_number, status, created_at")
      .eq("merchant_id", merchant.id)
      .in("status", ["rejected", "failed"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
    src.userClient
      .from("bookings")
      .select("id, name, preferred_time, created_at")
      .eq("merchant_id", merchant.id)
      .eq("source", "voice")
      .eq("status", "new")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
    src.userClient
      .from("billing_payments")
      .select("id, plan, updated_at, created_at")
      .eq("merchant_id", merchant.id)
      .eq("status", "failed")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
    src.userClient
      .from("ai_employees")
      .select("id, display_name, updated_at")
      .eq("merchant_id", merchant.id)
      .eq("status", "active")
      .eq("billing_status", "past_due")
      .limit(PER_SOURCE)
  ]);
  assertNoDbError(state.error, "Load notification state", ctx);
  assertNoDbError(events.error, "Load escalations", ctx);
  assertNoDbError(posts.error, "Load failed posts", ctx);
  assertNoDbError(invoices.error, "Load invoice problems", ctx);
  assertNoDbError(bookings.error, "Load bookings", ctx);
  assertNoDbError(payments.error, "Load payments", ctx);
  assertNoDbError(employees.error, "Load employee billing", ctx);

  const drafts: Draft[] = [];
  for (const row of (events.data ?? []) as EventRow[]) {
    const item = fromEvent(row);
    if (item) drafts.push(item);
  }
  for (const row of (posts.data ?? []) as Array<{ id: string; hook: string | null; scheduled_for: string }>) {
    drafts.push({ id: `post:${row.id}`, kind: "post_failed", at: row.scheduled_for, href: "/social", title: TITLES.post_failed, detail: clip(row.hook) });
  }
  for (const row of (invoices.data ?? []) as Array<{ id: string; invoice_number: string; status: string; created_at: string }>) {
    drafts.push({
      id: `invoice:${row.id}`,
      kind: "invoice_problem",
      at: row.created_at,
      href: `/invoices/${row.id}`,
      title: TITLES.invoice_problem,
      detail: clip(row.invoice_number, 60)
    });
  }
  for (const row of (bookings.data ?? []) as Array<{ id: string; name: string; preferred_time: string | null; created_at: string }>) {
    const when = clip(row.preferred_time, 60);
    drafts.push({
      id: `booking:${row.id}`,
      kind: "voice_booking",
      at: row.created_at,
      href: "/voice",
      title: TITLES.voice_booking,
      detail: clip(when ? `${row.name} · ${when}` : row.name)
    });
  }
  for (const row of (payments.data ?? []) as Array<{ id: string; plan: string; updated_at: string | null; created_at: string }>) {
    drafts.push({
      id: `payment:${row.id}`,
      kind: "payment_failed",
      at: row.updated_at ?? row.created_at,
      href: "/billing",
      title: TITLES.payment_failed,
      detail: clip(row.plan, 40)
    });
  }
  if (merchant.subscription_status === "past_due") {
    drafts.push({
      id: "subscription:past_due",
      kind: "subscription_past_due",
      at: merchant.subscription_expires_at ?? new Date(0).toISOString(),
      href: "/billing",
      title: TITLES.subscription_past_due,
      detail: null
    });
  }
  for (const row of (employees.data ?? []) as Array<{ id: string; display_name: string | null; updated_at: string | null }>) {
    drafts.push({
      id: `employee-billing:${row.id}`,
      kind: "employee_billing_past_due",
      at: row.updated_at ?? new Date(0).toISOString(),
      href: `/employees/${row.id}`,
      title: TITLES.employee_billing_past_due,
      detail: clip(row.display_name, 64)
    });
  }

  const lastSeenAt = (state.data as { last_seen_at?: string } | null)?.last_seen_at ?? null;
  return buildFeed(drafts, lastSeenAt);
}

/** Sort newest first, cap, and mark items newer than `lastSeenAt` as unread. Pure. */
export function buildFeed(drafts: Draft[], lastSeenAt: string | null, limit = NOTIFICATION_LIMIT): NotificationFeed {
  const seen = lastSeenAt ? new Date(lastSeenAt).getTime() : null;
  const items = [...drafts]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit)
    .map((d) => ({ ...d, unread: seen === null ? new Date(d.at).getTime() > 0 : new Date(d.at).getTime() > seen }));
  return { items, unread_count: items.filter((i) => i.unread).length, last_seen_at: lastSeenAt };
}
