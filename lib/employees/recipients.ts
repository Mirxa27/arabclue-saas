/**
 * Outbound recipients chosen by the model (SW-1).
 *
 * A model-chosen recipient is only accepted when
 *   1. its format is valid for the channel (normalised here), and
 *   2. the channel is a messaging integration this employee has connected, and
 *   3. it is either the counterpart of one of this employee's existing conversations on
 *      that channel, or it appears literally in text the merchant wrote in this turn / task
 *      (`authoredText`) — so recipients injected through tool output, an old transcript or
 *      a customer message can never be introduced.
 * Customer-originated (inbound) turns never get here: they can only reply in their own
 * conversation (lib/employees/tools.ts).
 */
import { getServiceSupabase } from "@/lib/db/supabase";
import { toAsciiDigits } from "@/lib/i18n/digits";
import type { MessagingChannel } from "./channels/dispatch";
import type { IntegrationKind } from "./types";

export type RecipientCheck =
  | { ok: true; to: string; basis: "known_contact" | "named_by_merchant" }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@<>()",;:\\]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

function digits(value: string): string {
  return toAsciiDigits(value).replace(/\D/g, "");
}

/** Normalised recipient for `channel`, or null when it is not a valid address there. */
export function normalizeRecipient(channel: IntegrationKind, raw: string): string | null {
  const value = toAsciiDigits(raw.trim());
  if (!value || value.length > 200) return null;
  switch (channel) {
    case "whatsapp": {
      // WhatsApp Cloud API: international number, digits only (wa_id form).
      if (!/^\+?[\d\s\-().]{8,24}$/.test(value)) return null;
      const d = digits(value);
      return d.length >= 8 && d.length <= 15 && !d.startsWith("0") ? d : null;
    }
    case "twilio_sms": {
      if (!/^\+?[\d\s\-().]{8,24}$/.test(value)) return null;
      const d = digits(value);
      return d.length >= 8 && d.length <= 15 && !d.startsWith("0") ? `+${d}` : null;
    }
    case "telegram":
      return /^-?\d{1,20}$/.test(value) ? value : null;
    case "slack":
      return /^[CDGUW][A-Z0-9]{6,20}$/.test(value) || /^#[a-z0-9_-]{1,80}$/.test(value) ? value : null;
    case "email":
    case "gmail":
      return EMAIL_RE.test(value) ? value.toLowerCase() : null;
    case "meta":
    case "instagram":
      return /^\d{5,32}$/.test(value) ? value : null;
    case "webhook":
      // `to` is only a label inside the payload; the URL is fixed by the merchant's config.
      return /^[^\r\n\0]{1,200}$/.test(value) ? value : null;
    default:
      return null;
  }
}

/** Is `to` (already normalised) written in the merchant's own text? */
export function namedInText(channel: IntegrationKind, to: string, authoredText: string): boolean {
  const text = toAsciiDigits(authoredText ?? "");
  if (!text.trim()) return false;
  switch (channel) {
    case "whatsapp":
    case "twilio_sms": {
      const target = digits(to);
      const candidates = text.match(/\+?\d[\d\s\-().]{6,22}\d/g) ?? [];
      return candidates.some((c) => {
        const d = digits(c);
        if (d === target) return true;
        // A national number the merchant typed ("0501234567") that the model expanded.
        const national = d.replace(/^0+/, "");
        return national.length >= 8 && national !== d && target.endsWith(national);
      });
    }
    case "email":
    case "gmail":
      return text.toLowerCase().includes(to.toLowerCase());
    default: {
      const escaped = to.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`).test(text);
    }
  }
}

/** The stored conversation external_id form of a normalised recipient. */
function conversationExternalIds(channel: IntegrationKind, to: string): string[] {
  if (channel === "whatsapp") return [to, `+${to}`];
  if (channel === "twilio_sms") return [to, to.replace(/^\+/, "")];
  return [to];
}

async function isKnownContact(employeeId: string, channel: IntegrationKind, to: string): Promise<boolean> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("ai_employee_conversations")
    .select("id")
    .eq("employee_id", employeeId)
    .eq("channel", channel)
    .in("external_id", conversationExternalIds(channel, to))
    .limit(1);
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

/** Full check for a model-chosen recipient on a merchant-trusted turn or task. */
export async function checkRecipient(args: {
  employeeId: string;
  channel: MessagingChannel;
  rawTo: string;
  connectedKinds: readonly IntegrationKind[];
  authoredText: string;
}): Promise<RecipientCheck> {
  if (!args.connectedKinds.includes(args.channel)) {
    return { ok: false, error: `${args.channel} is not connected for this employee` };
  }
  const to = normalizeRecipient(args.channel, args.rawTo);
  if (!to) return { ok: false, error: `"${args.rawTo.slice(0, 64)}" is not a valid ${args.channel} recipient` };
  if (namedInText(args.channel, to, args.authoredText)) return { ok: true, to, basis: "named_by_merchant" };
  if (await isKnownContact(args.employeeId, args.channel, to)) return { ok: true, to, basis: "known_contact" };
  return {
    ok: false,
    error: "recipient refused: it is not one of this employee's contacts and the merchant did not name it in this request"
  };
}
