/**
 * POST /api/meta/webhook — the platform Meta app's callback (social handover pipeline).
 *
 * F06: every delivery must carry X-Hub-Signature-256 = HMAC-SHA256(raw body,
 * META_APP_SECRET) — no secret: 503, bad signature: 403, both before the body is
 * parsed. The platform is chosen from `body.object`:
 *   instagram                 → comments (entry.changes, field "comments") and DMs
 *                               (entry.messaging) for the merchant whose social_channels
 *                               instagram external_id is entry.id
 *   whatsapp_business_account → messages (entry.changes, field "messages"), merchant by
 *                               value.metadata.phone_number_id (the stored whatsapp external_id)
 *   page                      → Messenger has no social_channels platform: acknowledged, ignored
 * Each event is claimed once (provider "meta_social" — independent of the AI-employee
 * DM claims, so this pipeline can never swallow an employee's reply) and handed to
 * processSocialInbound in after(), which runs the engager and records events; it
 * never sends a reply.
 */
import { after, NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceSupabase } from "@/lib/db/supabase";
import {
  metaWebhookEventId,
  parseMetaMessagingWebhook,
  resolveMetaVerifyChallenge,
  verifyMetaSignature
} from "@/lib/employees/channels/meta-inbound";
import { parseWhatsAppWebhook } from "@/lib/employees/channels/whatsapp";
import { readRawBody, WEBHOOK_MAX_BYTES } from "@/lib/http/raw-body";
import { reportError } from "@/lib/observability/error-reporter";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { processSocialInbound } from "@/lib/social/handover";
import type { Platform } from "@/lib/social/types";
import { hashWebhookPayload } from "@/lib/webhooks/idempotency";
import { claimInboundEvents, inboundAck, processClaimedInbound } from "@/lib/webhooks/inbound-claims";

export const META_PLATFORM_ROUTE = "POST /api/meta/webhook";
export const META_SOCIAL_PROVIDER = "meta_social";
const MAX_TEXT_CHARS = 4000;

export type MetaSocialEvent = {
  eventId: string;
  /** social_channels (platform, external_id) that owns the event. */
  platform: Platform;
  externalId: string;
  kind: "dm" | "comment";
  from: string;
  text: string;
};

export type MetaPlatformParse = {
  object: string | null;
  events: MetaSocialEvent[];
  skipped: Record<string, number>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function idOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return "";
}

function cap(text: string): string {
  const cps = Array.from(text.trim());
  return cps.length > MAX_TEXT_CHARS ? cps.slice(0, MAX_TEXT_CHARS).join("") : cps.join("");
}

/** Normalise a platform-app delivery into social events. Pure. */
export function parseMetaPlatformWebhook(payload: unknown, nowMs: number): MetaPlatformParse {
  const skipped: Record<string, number> = {};
  const skip = (reason: string, n = 1) => {
    if (n > 0) skipped[reason] = (skipped[reason] ?? 0) + n;
  };
  const root = asRecord(payload);
  const object = typeof root?.object === "string" ? root.object : null;
  const entries = Array.isArray(root?.entry) ? (root.entry as unknown[]) : [];
  const events: MetaSocialEvent[] = [];

  if (object === "instagram") {
    for (const rawEntry of entries) {
      const entry = asRecord(rawEntry);
      const entryId = idOf(entry?.id);
      if (!entry || !entryId) {
        skip("malformed");
        continue;
      }
      for (const rawChange of Array.isArray(entry.changes) ? entry.changes : []) {
        const change = asRecord(rawChange);
        if (change?.field !== "comments") {
          skip("unsupported_field");
          continue;
        }
        const value = asRecord(change.value);
        const from = asRecord(value?.from);
        const text = cap(typeof value?.text === "string" ? value.text : typeof value?.message === "string" ? value.message : "");
        if (!text) {
          skip("empty");
          continue;
        }
        if (from && idOf(from.id) === entryId) {
          skip("self"); // the business's own comment / reply
          continue;
        }
        const commentId = idOf(value?.id) || idOf(value?.comment_id);
        events.push({
          eventId: commentId
            ? `instagram_comment:${commentId}`
            : `instagram_comment:sha256:${hashWebhookPayload(`${entryId}|${idOf(from?.id)}|${text}`).slice(0, 32)}`,
          platform: "instagram",
          externalId: entryId,
          kind: "comment",
          from: (typeof from?.username === "string" && from.username) || idOf(from?.id) || "unknown",
          text
        });
      }
      // Instagram DMs to the platform app (same filters as the employee route: echoes, receipts, … dropped).
      const dms = parseMetaMessagingWebhook(
        { entry: [{ id: entryId, time: entry.time, messaging: entry.messaging }] },
        { kind: "instagram", accountId: entryId, nowMs }
      );
      for (const [reason, n] of Object.entries(dms.skipped)) skip(reason, n ?? 0);
      for (const m of dms.accepted) {
        events.push({
          eventId: metaWebhookEventId("instagram", m.mid),
          platform: "instagram",
          externalId: entryId,
          kind: "dm",
          from: m.senderId,
          text: m.text
        });
      }
    }
  } else if (object === "whatsapp_business_account") {
    for (const m of parseWhatsAppWebhook(payload)) {
      const text = m.text ? cap(m.text) : "";
      if (!text) {
        skip("non_text");
        continue;
      }
      if (!m.phoneNumberId) {
        skip("malformed");
        continue;
      }
      events.push({
        eventId: `whatsapp:${m.messageId}`,
        platform: "whatsapp",
        externalId: m.phoneNumberId,
        kind: "dm",
        from: m.from,
        text
      });
    }
  } else {
    // "page" (Messenger) and anything else: the social pipeline has no channel for it.
    skip("unsupported_object", Math.max(1, entries.length));
  }

  return { object, events, skipped };
}

async function merchantForExternalId(
  supabase: SupabaseClient,
  platform: Platform,
  externalId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("social_channels")
    .select("merchant_id")
    .eq("platform", platform)
    .eq("external_id", externalId)
    .maybeSingle();
  if (error) throw new Error(`social_channels lookup failed: ${error.message}`);
  return (data as { merchant_id?: string } | null)?.merchant_id ?? null;
}

/** GET handshake for the platform app's callback (constant-time token check). */
export function verifyMetaPlatformSubscription(req: NextRequest): Response {
  const challenge = resolveMetaVerifyChallenge(req.nextUrl.searchParams, [process.env.META_WEBHOOK_VERIFY_TOKEN?.trim()]);
  if (!challenge) return new NextResponse("forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

type ResolvedSocialEvent = MetaSocialEvent & { merchantId: string };

export async function receiveMetaPlatformWebhook(req: NextRequest): Promise<NextResponse> {
  const limited = await enforceRateLimit(req, "meta:webhook", 600, 60_000);
  if (limited instanceof NextResponse) return limited;

  const raw = await readRawBody(req, WEBHOOK_MAX_BYTES);
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appSecret) {
    reportError(new Error("META_APP_SECRET is not configured; refusing unsigned Meta webhooks"), {
      route: META_PLATFORM_ROUTE,
      status: 503
    });
    return NextResponse.json({ error: "META_APP_SECRET not configured", code: "webhook_not_configured" }, { status: 503 });
  }
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = parseMetaPlatformWebhook(payload, Date.now());
  const skipped = { ...parsed.skipped };
  const supabase = getServiceSupabase();

  const owners = new Map<string, string | null>();
  const resolved: ResolvedSocialEvent[] = [];
  for (const event of parsed.events) {
    const key = `${event.platform}:${event.externalId}`;
    if (!owners.has(key)) owners.set(key, await merchantForExternalId(supabase, event.platform, event.externalId));
    const merchantId = owners.get(key);
    if (!merchantId) {
      skipped.unknown_account = (skipped.unknown_account ?? 0) + 1;
      continue;
    }
    resolved.push({ ...event, merchantId });
  }

  const summary = await claimInboundEvents(
    META_SOCIAL_PROVIDER,
    resolved.map((event) => ({ eventId: event.eventId, item: event }))
  );

  const claimed = summary.claimed;
  if (claimed.length > 0) {
    after(() =>
      processClaimedInbound<ResolvedSocialEvent>({
        provider: META_SOCIAL_PROVIDER,
        route: META_PLATFORM_ROUTE,
        claimed,
        orderKey: (e) => `${e.merchantId}:${e.from}`,
        handle: async (e) => {
          await processSocialInbound(getServiceSupabase(), {
            merchantId: e.merchantId,
            platform: e.platform,
            kind: e.kind,
            from: e.from,
            text: e.text
          });
        }
      })
    );
  }

  return inboundAck(summary, META_PLATFORM_ROUTE, { skipped });
}
