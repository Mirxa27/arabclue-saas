import { z } from "zod";

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
  id: z.string().uuid(),
  status: MoyasarPaymentStatusSchema,
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  description: z.string().optional().nullable(),
  callback_url: z.string().url().optional().nullable(),
  metadata: z.record(z.string()).optional().nullable(),
  created_at: z.string(),
  updated_at: z.string().optional()
});

export type MoyasarPayment = z.infer<typeof MoyasarPaymentSchema>;

export const MoyasarWebhookEventSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  created_at: z.string(),
  secret_token: z.string().optional(),
  account_name: z.string().optional(),
  live: z.boolean().optional(),
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
