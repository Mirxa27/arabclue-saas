import { z } from "zod";
import { boundedRecord } from "@/lib/api/zod-bounds";

/**
 * Moyasar metadata limits: "up to 30 keys, with key names up to 40 characters
 * long and values up to 500 characters long" (https://docs.moyasar.com/api/metadata).
 * The key count is checked before any entry is parsed (critic-5).
 */
export const MoyasarMetadataSchema = boundedRecord(30, z.string().min(1).max(40), z.string().max(500));

export const MoyasarPaymentStatusSchema = z.enum([
  "initiated",
  "paid",
  "authorized",
  "failed",
  "refunded",
  "captured",
  "voided",
  "verified"
]);

export const MoyasarPaymentSchema = z.object({
  id: z.guid(),
  status: MoyasarPaymentStatusSchema,
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  description: z.string().optional().nullable(),
  callback_url: z.string().url().optional().nullable(),
  metadata: MoyasarMetadataSchema.optional().nullable(),
  created_at: z.string(),
  updated_at: z.string().optional()
});

export type MoyasarPayment = z.infer<typeof MoyasarPaymentSchema>;

/**
 * The webhook object (https://docs.moyasar.com/api/other/webhooks/webhook-reference):
 * `data` is a payment for payment_* events and a card authentication for card_auth_*
 * events, so the envelope leaves it open; MoyasarWebhookEventSchema narrows it to a payment.
 * Parse only after the secret_token has been checked (app/api/billing/webhook).
 */
export const MoyasarWebhookEnvelopeSchema = z.object({
  id: z.guid(),
  type: z.string().min(1).max(64),
  created_at: z.string().max(64),
  secret_token: z.string().max(512).optional(),
  account_name: z.string().max(200).optional().nullable(),
  live: z.boolean().optional(),
  data: z.unknown()
});

export type MoyasarWebhookEnvelope = z.infer<typeof MoyasarWebhookEnvelopeSchema>;

export const MoyasarWebhookEventSchema = MoyasarWebhookEnvelopeSchema.extend({
  data: MoyasarPaymentSchema
});

export type MoyasarWebhookEvent = z.infer<typeof MoyasarWebhookEventSchema>;

export class MoyasarApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = "MoyasarApiError";
  }
}
