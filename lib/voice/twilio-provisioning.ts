/**
 * Buying a Twilio number for a merchant's voice agent without leaking paid numbers (F35).
 *
 * 1. claim_voice_number_provisioning() takes a per-merchant reservation under a row lock
 *    (concurrent/repeated requests get "in_progress" instead of buying a second number)
 *    and enforces a durable daily cap on purchases.
 * 2. On replace, the old number is released FIRST; if Twilio refuses, nothing is bought.
 * 3. The purchased number is recorded and the reservation cleared in one update; if that
 *    write fails — or matches no row because the account was deleted meanwhile (SW-22) — the
 *    new number is released again so it is not billed unused, and queued for the release cron
 *    (lib/voice/number-release.ts) if Twilio refuses that too.
 * Every failure path clears the reservation so the merchant can retry.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/api/errors";
import { assertNoDbError } from "@/lib/db/errors";
import { reportError } from "@/lib/observability/error-reporter";
import { provisionVoiceNumber, releaseVoiceNumber, type TwilioConfig } from "@/lib/voice/twilio";

export const MAX_NUMBERS_PER_DAY = 3;
export const PROVISIONING_STALE_SECONDS = 600;

const ROUTE = "POST /api/voice/provision-number";

type ClaimOutcome =
  | { outcome: "claimed"; phone_number: string | null; twilio_incoming_sid: string | null }
  | { outcome: "already_provisioned"; phone_number: string }
  | { outcome: "in_progress" }
  | { outcome: "rate_limited"; provisioned_last_24h?: number };

export type ProvisionResult =
  | { status: "already_provisioned"; phoneNumber: string }
  | { status: "provisioned"; phoneNumber: string; sid: string; replaced: boolean };

export type TwilioNumberOps = {
  provision: (cfg: TwilioConfig) => Promise<{ sid: string; phoneNumber: string }>;
  release: (cfg: TwilioConfig, incomingSid: string) => Promise<void>;
};

const DEFAULT_OPS: TwilioNumberOps = { provision: provisionVoiceNumber, release: releaseVoiceNumber };

/** Release a bought-but-unrecorded number now; if Twilio refuses, queue it for the release cron. */
async function releaseUnrecordedNumber(
  sb: SupabaseClient,
  twilio: TwilioConfig,
  ops: TwilioNumberOps,
  merchantId: string,
  purchased: { sid: string; phoneNumber: string }
): Promise<void> {
  try {
    await ops.release(twilio, purchased.sid);
  } catch (err) {
    reportError(err, { route: ROUTE, merchantId, extra: { step: "release unrecorded number", sid: purchased.sid } });
    const { queueUnrecordedPurchase } = await import("@/lib/voice/number-release");
    await queueUnrecordedPurchase(sb, purchased.sid, purchased.phoneNumber);
  }
}

async function clearReservation(sb: SupabaseClient, merchantId: string) {
  const { error } = await sb
    .from("voice_configs")
    .update({ provisioning_started_at: null })
    .eq("merchant_id", merchantId);
  if (error) reportError(new Error(`clear provisioning reservation: ${error.message}`), { route: ROUTE, merchantId });
}

export async function provisionMerchantVoiceNumber(
  sb: SupabaseClient,
  twilio: TwilioConfig,
  merchantId: string,
  opts: { replace: boolean },
  ops: TwilioNumberOps = DEFAULT_OPS
): Promise<ProvisionResult> {
  const { data, error } = await sb.rpc("claim_voice_number_provisioning", {
    p_merchant_id: merchantId,
    p_replace: opts.replace,
    p_stale_seconds: PROVISIONING_STALE_SECONDS,
    p_max_per_day: MAX_NUMBERS_PER_DAY
  });
  assertNoDbError(error, "Reserve number provisioning", { route: ROUTE, merchantId, code: "provisioning_failed" });

  const claim = data as ClaimOutcome | null;
  switch (claim?.outcome) {
    case "already_provisioned":
      return { status: "already_provisioned", phoneNumber: claim.phone_number };
    case "in_progress":
      throw new HttpError(409, "A number is already being provisioned for this store. Try again in a minute.", "provisioning_in_progress");
    case "rate_limited":
      throw new HttpError(429, `Number provisioning is limited to ${MAX_NUMBERS_PER_DAY} numbers per day.`, "provisioning_rate_limited");
    case "claimed":
      break;
    default:
      throw new HttpError(500, "Number provisioning failed", "provisioning_failed");
  }

  try {
    let replaced = false;
    if (claim.twilio_incoming_sid) {
      try {
        await ops.release(twilio, claim.twilio_incoming_sid);
      } catch (err) {
        reportError(err, { route: ROUTE, merchantId, extra: { step: "release old number" } });
        throw new HttpError(
          502,
          "Twilio could not release the current number, so no new number was purchased. Try again later.",
          "release_failed"
        );
      }
      // The old number is gone at Twilio: forget it before buying, so a failed purchase
      // leaves an honest "no number" state rather than a dead one.
      const { error: clearErr } = await sb
        .from("voice_configs")
        .update({ phone_number: null, twilio_incoming_sid: null, updated_at: new Date().toISOString() })
        .eq("merchant_id", merchantId);
      assertNoDbError(clearErr, "Clear released number", { route: ROUTE, merchantId, code: "provisioning_failed" });
      replaced = true;
    }

    let purchased: { sid: string; phoneNumber: string };
    try {
      purchased = await ops.provision(twilio);
    } catch (err) {
      reportError(err, { route: ROUTE, merchantId, extra: { step: "purchase number" } });
      throw new HttpError(502, "Twilio could not provision a number. Try again later.", "purchase_failed");
    }

    const { data: saved, error: saveErr } = await sb
      .from("voice_configs")
      .update({
        phone_number: purchased.phoneNumber,
        twilio_incoming_sid: purchased.sid,
        enabled: true,
        provisioning_started_at: null,
        entitlement_lost_at: null,
        updated_at: new Date().toISOString()
      })
      .eq("merchant_id", merchantId)
      .select("merchant_id");
    // No row matched: the account was deleted while Twilio was selling us the number.
    const unrecorded = !saveErr && Array.isArray(saved) && saved.length === 0;
    if (saveErr || unrecorded) {
      // Do not keep paying for a number no call can be routed to.
      await releaseUnrecordedNumber(sb, twilio, ops, merchantId, purchased);
      if (unrecorded) throw new HttpError(409, "This store no longer exists.", "merchant_gone");
      assertNoDbError(saveErr, "Save provisioned number", { route: ROUTE, merchantId, code: "provisioning_failed" });
    }

    // Counted by the daily cap in claim_voice_number_provisioning().
    const { error: eventErr } = await sb.from("events").insert({
      kind: "voice.number_provisioned",
      merchant: merchantId,
      payload: { phoneNumber: purchased.phoneNumber, sid: purchased.sid, replaced }
    });
    if (eventErr) reportError(new Error(`record voice.number_provisioned: ${eventErr.message}`), { route: ROUTE, merchantId });

    return { status: "provisioned", phoneNumber: purchased.phoneNumber, sid: purchased.sid, replaced };
  } catch (err) {
    await clearReservation(sb, merchantId);
    throw err;
  }
}
