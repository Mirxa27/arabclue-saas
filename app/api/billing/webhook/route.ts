import { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/route-handler";
import { MoyasarWebhookEnvelopeSchema, MoyasarWebhookEventSchema } from "@/lib/moyasar/types";
import {
  hasValidMoyasarSecretToken,
  MOYASAR_ACTIVATION_EVENTS,
  MOYASAR_WEBHOOK_MAX_BYTES,
  moyasarWebhookSecret
} from "@/lib/moyasar/webhook";
import { handleMoyasarWebhookPayment } from "@/lib/billing/service";
import { getServiceSupabase } from "@/lib/db/supabase";
import { readTextBody } from "@/lib/http/raw-body";
import { runWebhookOnce } from "@/lib/webhooks/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "POST /api/billing/webhook";

/**
 * Moyasar payment webhook. Order: capped body (413) → secret configured (503) →
 * JSON (400) → `secret_token` equals MOYASAR_WEBHOOK_SECRET (401) → schemas (400)
 * → claim → process once (duplicates 200, in-flight 409, failures 5xx so Moyasar retries).
 */
export async function POST(req: NextRequest) {
  try {
    const raw = await readTextBody(req, MOYASAR_WEBHOOK_MAX_BYTES);
    const secret = moyasarWebhookSecret();
    if (!secret) {
      return NextResponse.json(
        { error: "Moyasar webhook secret not configured", code: "webhook_not_configured" },
        { status: 503 }
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }
    if (!hasValidMoyasarSecretToken(json, secret)) {
      return NextResponse.json({ error: "invalid secret token" }, { status: 401 });
    }

    const envelope = MoyasarWebhookEnvelopeSchema.parse(json);
    if (!MOYASAR_ACTIVATION_EVENTS.has(envelope.type)) {
      // Refunds, failures, voids, card_auth_* … nothing to activate — acknowledge so Moyasar stops retrying.
      return NextResponse.json({ ok: true, ignored: envelope.type });
    }
    const event = MoyasarWebhookEventSchema.parse(json);

    const supabase = getServiceSupabase();
    // Claim → process → complete; a failure releases the claim so Moyasar's retry is processed.
    const outcome = await runWebhookOnce(supabase, "moyasar", event.id, async () => {
      await handleMoyasarWebhookPayment(event.data.id);
    });
    if (outcome.status === "duplicate") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    if (outcome.status === "in_progress") {
      return NextResponse.json({ error: "event is being processed" }, { status: 409 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
