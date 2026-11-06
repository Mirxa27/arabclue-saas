/**
 * Booking requests and hand-overs from phone calls (SW-24): saved where the merchant sees them,
 * announced to the merchant, and only confirmed to the caller when the write succeeded.
 *
 *  - bookings (source 'voice') and voice_escalations are merchant-visible (RLS); the voice page
 *    lists them and moves their status (GET/PATCH /api/voice/bookings, /api/voice/escalations).
 *  - every saved request writes a minimised event (voice.booking / voice.escalation: ids and the
 *    notification outcome — no caller name, number or free text, SW-45) and e-mails the store
 *    owner from the platform sender. The e-mail is fixed copy plus a dashboard link (callers'
 *    words never reach a platform e-mail) and capped per merchant per hour.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isPlatformEmailConfigured, platformFromAddress, sendPlatformEmail } from "@/lib/email/platform";
import { reportError } from "@/lib/observability/error-reporter";
import { rateLimit } from "@/lib/security/rate-limit";
import type { VoiceBookingInput, VoiceEscalationInput } from "@/lib/voice/agent";
import { isE164 } from "@/lib/voice/phone";
import type { VoiceBookingEntry, VoiceBookingStatus, VoiceEscalationEntry, VoiceEscalationStatus } from "@/lib/voice/types";

const ROUTE = "POST /api/voice/webhook";

export type OwnerNotice = "email" | "not_configured" | "no_owner_email" | "failed" | "rate_limited";

/** Owner e-mails per merchant per hour (a flood of calls must not become a flood of mail). */
export const OWNER_EMAILS_PER_HOUR = 10;

async function ownerEmail(sb: SupabaseClient, merchantId: string): Promise<string | null> {
  try {
    const { data } = await sb.from("merchants").select("owner_user_id").eq("id", merchantId).maybeSingle();
    const ownerId = (data as { owner_user_id?: string | null } | null)?.owner_user_id;
    if (!ownerId) return null;
    const { data: user } = await sb.auth.admin.getUserById(ownerId);
    return user?.user?.email ?? null;
  } catch {
    return null;
  }
}

const NOTICE_COPY = {
  booking: {
    subject: "طلب حجز جديد من المساعد الصوتي | New booking request from your voice agent",
    ar: "سجّل سالم، مساعدك الصوتي، طلب حجز جديداً من مكالمة. راجِعه وأكّده مع العميل من لوحة التحكم.",
    en: "Salem, your voice agent, recorded a new booking request from a call. Review it and confirm it with the customer in your dashboard."
  },
  escalation: {
    subject: "متصل يحتاج متابعتك | A caller needs a follow-up",
    ar: "طلب أحد المتصلين متابعة من فريق متجرك. تجد التفاصيل ورقم معاودة الاتصال في لوحة التحكم.",
    en: "A caller asked for a follow-up from your store team. The details and the callback number are in your dashboard."
  }
} as const;

/** Best-effort, fixed-copy owner e-mail; the outcome is recorded, never assumed. */
export async function notifyMerchantOwner(
  sb: SupabaseClient,
  merchantId: string,
  kind: keyof typeof NOTICE_COPY
): Promise<OwnerNotice> {
  if (!isPlatformEmailConfigured()) return "not_configured";
  const to = await ownerEmail(sb, merchantId);
  if (!to) return "no_owner_email";
  const budget = await rateLimit(`voice:owner-email:${merchantId}`, OWNER_EMAILS_PER_HOUR, 60 * 60_000);
  if (!budget.success) return "rate_limited";
  const copy = NOTICE_COPY[kind];
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  const link = site ? `${site}/voice` : null;
  const text = [copy.ar, ...(link ? [link] : []), "", copy.en, ...(link ? [link] : []), "", "— arabclue"].join("\n");
  try {
    await sendPlatformEmail({ from: platformFromAddress() }, { to, subject: copy.subject, text });
    return "email";
  } catch (err) {
    reportError(err, { merchantId, extra: { step: `voice_${kind}_email` } });
    return "failed";
  }
}

async function logEvent(sb: SupabaseClient, kind: string, merchantId: string, payload: Record<string, unknown>) {
  const { error } = await sb.from("events").insert({ kind, merchant: merchantId, payload });
  if (error) reportError(new Error(`${kind} event: ${error.message}`), { route: ROUTE, merchantId });
}

/** Save a booking request; its id, or null when it could not be saved (reported). */
export async function recordVoiceBooking(
  sb: SupabaseClient,
  args: { merchantId: string; callSid: string | null; booking: VoiceBookingInput }
): Promise<string | null> {
  const { merchantId, callSid, booking } = args;
  const { data, error } = await sb
    .from("bookings")
    .insert({
      merchant_id: merchantId,
      name: booking.name,
      mobile: booking.mobile,
      preferred_time: booking.preferredTime,
      note: booking.note ?? null,
      source: "voice",
      status: "new"
    })
    .select("id")
    .single();
  const id = (data as { id?: string } | null)?.id;
  if (error || !id) {
    reportError(new Error(`voice booking insert failed: ${error?.message ?? "no id returned"}`), { route: ROUTE, merchantId });
    return null;
  }
  const notified = await notifyMerchantOwner(sb, merchantId, "booking");
  await logEvent(sb, "voice.booking", merchantId, { booking_id: id, call_sid: callSid, notified });
  return String(id);
}

/**
 * Save a hand-over. One open escalation per call: a second request in the same call (e.g. the
 * caller then gives a callback number) updates it instead of creating another.
 */
export async function recordVoiceEscalation(
  sb: SupabaseClient,
  args: { merchantId: string; callSid: string | null; escalation: VoiceEscalationInput }
): Promise<string | null> {
  const { merchantId, callSid, escalation } = args;
  const callback = isE164(escalation.callbackNumber) ? escalation.callbackNumber : null;
  try {
    if (callSid) {
      const { data: open, error: openErr } = await sb
        .from("voice_escalations")
        .select("id, callback_number")
        .eq("merchant_id", merchantId)
        .eq("call_sid", callSid)
        .eq("status", "open")
        .maybeSingle();
      if (openErr) throw new Error(`voice escalation lookup failed: ${openErr.message}`);
      const existing = open as { id: string; callback_number: string | null } | null;
      if (existing) {
        const { error } = await sb
          .from("voice_escalations")
          .update({
            reason: escalation.reason,
            summary: escalation.summary ?? null,
            callback_number: callback ?? existing.callback_number
          })
          .eq("id", existing.id)
          .eq("merchant_id", merchantId);
        if (error) throw new Error(`voice escalation update failed: ${error.message}`);
        return existing.id;
      }
    }

    const { data, error } = await sb
      .from("voice_escalations")
      .insert({
        merchant_id: merchantId,
        call_sid: callSid,
        reason: escalation.reason,
        summary: escalation.summary ?? null,
        callback_number: callback,
        status: "open"
      })
      .select("id")
      .single();
    const id = (data as { id?: string } | null)?.id;
    if (error || !id) throw new Error(`voice escalation insert failed: ${error?.message ?? "no id returned"}`);

    const notified = await notifyMerchantOwner(sb, merchantId, "escalation");
    const { error: noticeErr } = await sb.from("voice_escalations").update({ notified }).eq("id", id).eq("merchant_id", merchantId);
    if (noticeErr) reportError(new Error(`voice escalation notice: ${noticeErr.message}`), { route: ROUTE, merchantId });
    await logEvent(sb, "voice.escalation", merchantId, { escalation_id: id, call_sid: callSid, notified });
    return String(id);
  } catch (err) {
    reportError(err, { route: ROUTE, merchantId });
    return null;
  }
}

// ── merchant-facing lists ───────────────────────────────────────────────────────

export const MAX_REQUESTS_PAGE = 100;

export const BOOKING_STATUSES = ["new", "confirmed", "done", "canceled"] as const satisfies readonly VoiceBookingStatus[];
export const ESCALATION_STATUSES = ["open", "resolved"] as const satisfies readonly VoiceEscalationStatus[];

export const BookingPatchSchema = z.strictObject({ id: z.uuid(), status: z.enum(BOOKING_STATUSES) });
export const EscalationPatchSchema = z.strictObject({ id: z.uuid(), status: z.enum(ESCALATION_STATUSES) });

export function parseRequestsLimit(raw: string | null): number {
  const n = raw === null ? 50 : Number(raw);
  if (!Number.isInteger(n) || n < 1) return 50;
  return Math.min(n, MAX_REQUESTS_PAGE);
}

const BOOKING_COLUMNS = "id, name, mobile, preferred_time, note, status, created_at";
const ESCALATION_COLUMNS = "id, reason, summary, callback_number, status, created_at, resolved_at";

/** The merchant's phone bookings, newest first (merchant session, RLS bookings_self). */
export async function listVoiceBookings(
  sb: SupabaseClient,
  merchantId: string,
  opts: { status?: VoiceBookingStatus; limit: number }
): Promise<VoiceBookingEntry[]> {
  let query = sb.from("bookings").select(BOOKING_COLUMNS).eq("merchant_id", merchantId).eq("source", "voice");
  if (opts.status) query = query.eq("status", opts.status);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(opts.limit);
  if (error) throw new Error(`voice bookings lookup failed: ${error.message}`);
  return (data ?? []) as VoiceBookingEntry[];
}

/** Move one of the merchant's phone bookings to `status`; null when it is not theirs. */
export async function updateVoiceBookingStatus(
  sb: SupabaseClient,
  merchantId: string,
  id: string,
  status: VoiceBookingStatus
): Promise<VoiceBookingEntry | null> {
  const { data, error } = await sb
    .from("bookings")
    .update({ status })
    .eq("id", id)
    .eq("merchant_id", merchantId)
    .eq("source", "voice")
    .select(BOOKING_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`voice booking update failed: ${error.message}`);
  return (data as VoiceBookingEntry | null) ?? null;
}

export async function listVoiceEscalations(
  sb: SupabaseClient,
  merchantId: string,
  opts: { status?: VoiceEscalationStatus; limit: number }
): Promise<VoiceEscalationEntry[]> {
  let query = sb.from("voice_escalations").select(ESCALATION_COLUMNS).eq("merchant_id", merchantId);
  if (opts.status) query = query.eq("status", opts.status);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(opts.limit);
  if (error) throw new Error(`voice escalations lookup failed: ${error.message}`);
  return (data ?? []) as VoiceEscalationEntry[];
}

/** Service role (authenticated has no UPDATE on voice_escalations), scoped to the session's merchant. */
export async function updateVoiceEscalationStatus(
  sb: SupabaseClient,
  merchantId: string,
  id: string,
  status: VoiceEscalationStatus
): Promise<VoiceEscalationEntry | null> {
  const { data, error } = await sb
    .from("voice_escalations")
    .update({ status, resolved_at: status === "resolved" ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("merchant_id", merchantId)
    .select(ESCALATION_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`voice escalation update failed: ${error.message}`);
  return (data as VoiceEscalationEntry | null) ?? null;
}
