/**
 * Coded JSON errors for the voice API routes.
 *
 * `handleRouteError` answers `{ error }` only; the voice page maps the stable `code` of a refusal
 * to fixed Arabic + English text (lib/voice/messages.ts), so every coded HttpError — including the
 * honest 503s for "not configured" — keeps its code here. Server faults (5xx) are reported.
 */
import { NextResponse } from "next/server";
import { HttpError } from "@/lib/api/errors";
import { handleRouteError } from "@/lib/api/route-handler";
import { reportError } from "@/lib/observability/error-reporter";

/** A refusal with a stable `code` (and optional extra fields) for the voice page. */
export class VoiceApiError extends HttpError {
  readonly extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(status, message, code);
    this.name = "VoiceApiError";
    this.extra = extra;
  }
}

export function voiceRouteError(err: unknown, route: string): NextResponse {
  if (err instanceof HttpError && err.code) {
    // Not-configured 503s are expected states, not faults; anything else 5xx is reported.
    if (err.status >= 500 && !(err.status === 503 && err instanceof VoiceApiError)) {
      reportError(err, { route, status: err.status });
    }
    const extra = err instanceof VoiceApiError ? err.extra : {};
    return NextResponse.json({ error: err.message, code: err.code, ...extra }, { status: err.status });
  }
  return handleRouteError(err, { route });
}
