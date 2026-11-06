/**
 * Shared pieces of the per-employee inbound webhooks
 * (/api/employees/webhooks/{meta,whatsapp,slack,telegram,sms}/[id]).
 *
 * Every one of them: authenticates the exact request bytes and fails closed (503
 * when no secret is configured, 403 on a bad signature — no DB writes, no LLM call),
 * claims each provider message id before acknowledging, and runs the AI turn in
 * `after()` (lib/webhooks/inbound-claims.ts).
 */
import { NextResponse } from "next/server";
import { logAction } from "@/lib/employees/runtime";
import type { IntegrationKind } from "@/lib/employees/types";
import { reportError } from "@/lib/observability/error-reporter";
import { rateLimit } from "@/lib/security/rate-limit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Employee ids are uuids; anything else cannot match a row (and must not reach PostgREST as a 22P02). */
export function isEmployeeId(id: string): boolean {
  return UUID_RE.test(id);
}

/** Inbound messages older than this are not answered (Messenger / WhatsApp 24 h reply window). */
export const INBOUND_MAX_AGE_MS = 23 * 60 * 60 * 1000;
/** Inbound text is capped before it reaches the model. */
export const INBOUND_MAX_TEXT_CHARS = 4000;

export function capInboundText(text: string): string {
  const cps = Array.from(text.trim());
  return cps.length > INBOUND_MAX_TEXT_CHARS ? cps.slice(0, INBOUND_MAX_TEXT_CHARS).join("") : cps.join("");
}

export function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Note in the employee's activity feed that inbound deliveries are refused because
 * no secret is configured. At most once per 10 minutes per employee, channel and
 * reason, so unauthenticated traffic cannot flood the table. Never throws.
 */
export async function logInboundRejected(employeeId: string, channel: IntegrationKind, reason: string): Promise<void> {
  try {
    const gate = await rateLimit(`inbound-reject:${employeeId}:${channel}:${reason}`, 1, 10 * 60_000);
    if (!gate.success) return;
    await logAction({ employeeId, action: "inbound_rejected", channel, status: "failure", result: { reason } });
  } catch (err) {
    reportError(err, { extra: { step: "inbound_rejected_log", employeeId, channel } });
  }
}

export function notConfigured(message: string): NextResponse {
  return NextResponse.json({ error: message, code: "webhook_not_configured" }, { status: 503 });
}

export function forbidden(message = "forbidden"): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function invalidJson(): NextResponse {
  return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
}
