/**
 * Salla payload schemas, modelled on the documented samples:
 *   order.* webhooks      https://docs.salla.dev/doc-433804 (= /webhook-events/orders.md)
 *   app.store.authorize   https://docs.salla.dev/doc-421413#app-store-authorize
 *   GET /orders           https://docs.salla.dev/orders/list.md
 *   GET /products         https://docs.salla.dev/product/list-product.md
 * Unknown keys are stripped; the fields the app relies on are required.
 */
import { z } from "zod";

/** Salla amounts are numbers; a few fields (discounts, tax percent) arrive as numeric strings. */
const Numeric = z
  .union([z.number(), z.string().trim().regex(/^-?\d+(\.\d+)?$/, "expected a numeric string")])
  .transform((value) => Number(value))
  .pipe(z.number().finite());

const SallaId = z.union([z.number(), z.string().trim().min(1).max(64)]);

/** Paginated list wrapper of the Admin API. */
export const SallaListResponseSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    data: z.array(item).optional(),
    pagination: z
      .object({
        count: z.number().optional(),
        total: z.number().optional(),
        perPage: z.number().optional(),
        currentPage: z.number().optional(),
        totalPages: z.number().optional()
      })
      .optional()
  });

// ── products ────────────────────────────────────────────────────────────────

export const SallaProductSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string(),
  name_ar: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  price: z
    .union([
      z.number(),
      z.object({ amount: z.number().optional() }).passthrough()
    ])
    .optional()
    .nullable(),
  categories: z.array(z.object({ name: z.string().optional() }).passthrough()).optional(),
  main_image: z.string().optional().nullable(),
  urls: z.object({ customer: z.string().optional() }).optional().nullable(),
  quantity: z.number().optional().nullable()
});

export type SallaProduct = z.infer<typeof SallaProductSchema>;

export const SallaProductsResponseSchema = SallaListResponseSchema(SallaProductSchema);

// ── shared order building blocks ────────────────────────────────────────────

/** `{ amount, currency }` money object. */
export const SallaMoneySchema = z.object({
  amount: Numeric,
  currency: z.string().max(8).nullish()
});

/** PHP DateTime as Salla serialises it: wall-clock `date` in `timezone` (timezone_type 3 = IANA id). */
export const SallaDateSchema = z.object({
  date: z.string().max(64),
  timezone_type: z.number().nullish(),
  timezone: z.string().max(64).nullish()
});

export type SallaDate = z.infer<typeof SallaDateSchema>;

/** `{ percent: "15.00", amount: { amount, currency } }` */
export const SallaTaxSchema = z.object({
  percent: Numeric,
  amount: SallaMoneySchema
});

export const SallaOrderItemSchema = z.object({
  id: SallaId.optional(),
  name: z.string().max(1000),
  sku: z.string().max(200).nullish(),
  quantity: z.number().positive(),
  amounts: z.object({
    /** Before VAT and before order-level discounts. */
    price_without_tax: SallaMoneySchema,
    /** This item's share of the order discounts (already included in `amounts.discounts`). */
    total_discount: SallaMoneySchema.nullish(),
    tax: SallaTaxSchema.nullish(),
    total: SallaMoneySchema.nullish()
  })
});

export type SallaOrderItem = z.infer<typeof SallaOrderItemSchema>;

export const SallaOrderDiscountSchema = z.object({
  title: z.string().max(500).nullish(),
  type: z.string().max(64).nullish(),
  code: z.string().max(200).nullish(),
  discount: Numeric,
  currency: z.string().max(8).nullish(),
  /** Part of the discount applied to shipping (shipping_cost.amount is already net of it). */
  discounted_shipping: Numeric.nullish()
});

export const SallaOrderAmountsSchema = z.object({
  /** Items before VAT and before order discounts. */
  sub_total: SallaMoneySchema,
  /** `amount` is the final shipping cost (after shipping discounts). */
  shipping_cost: SallaMoneySchema.extend({
    original_cost: Numeric.nullish(),
    shipping_cost_discount: Numeric.nullish()
  }).nullish(),
  cash_on_delivery: SallaMoneySchema.nullish(),
  tax: SallaTaxSchema,
  discounts: z.array(SallaOrderDiscountSchema).max(100).nullish(),
  /** sub_total + shipping + cash on delivery + tax − discounts */
  total: SallaMoneySchema
});

export const SallaOrderCustomerSchema = z.object({
  id: SallaId.optional(),
  first_name: z.string().max(200).nullish(),
  last_name: z.string().max(200).nullish(),
  /** Some order events (e.g. order.status.updated) send one `name` instead. */
  name: z.string().max(400).nullish(),
  email: z.string().max(320).nullish(),
  mobile: z.union([z.number(), z.string().max(32)]).nullish(),
  mobile_code: z.string().max(8).nullish()
});

/** The order model shared by Salla's order.* webhook events. */
export const SallaOrderSchema = z.object({
  id: SallaId,
  /** The order number the merchant and the customer see. */
  reference_id: SallaId.nullish(),
  date: SallaDateSchema,
  draft: z.boolean().nullish(),
  status: z
    .object({ id: SallaId.optional(), name: z.string().max(200).optional(), slug: z.string().max(64).optional() })
    .nullish(),
  currency: z.string().max(8).nullish(),
  amounts: SallaOrderAmountsSchema,
  customer: SallaOrderCustomerSchema.nullish(),
  items: z.array(SallaOrderItemSchema).max(500)
});

export type SallaOrder = z.infer<typeof SallaOrderSchema>;

export const SallaOrderCreatedEventSchema = z.object({
  event: z.literal("order.created"),
  merchant: z.union([z.number(), z.string()]),
  created_at: z.string().optional(),
  data: SallaOrderSchema
});

export type SallaOrderCreatedEvent = z.infer<typeof SallaOrderCreatedEventSchema>;

// ── orders list (GET /orders) ───────────────────────────────────────────────

export const SallaOrderSummarySchema = z.object({
  id: SallaId,
  reference_id: SallaId.nullish(),
  status: z.object({ name: z.string().max(200).optional(), slug: z.string().max(64).optional() }).nullish(),
  total: SallaMoneySchema.nullish(),
  date: SallaDateSchema.nullish()
});

export type SallaOrderSummary = z.infer<typeof SallaOrderSummarySchema>;

export const SallaOrdersResponseSchema = SallaListResponseSchema(SallaOrderSummarySchema);

// ── app events ──────────────────────────────────────────────────────────────

/** Easy Mode token delivery. `expires` is a unix timestamp here (seconds). */
export const SallaAppStoreAuthorizeEventSchema = z.object({
  event: z.literal("app.store.authorize"),
  merchant: z.union([z.number(), z.string()]),
  created_at: z.string().optional(),
  data: z.object({
    access_token: z.string().min(1).max(4096),
    refresh_token: z.string().min(1).max(4096).nullish(),
    expires: z.number().optional(),
    scope: z.string().max(4096).nullish(),
    token_type: z.string().max(32).nullish()
  })
});

export type SallaAppStoreAuthorizeEvent = z.infer<typeof SallaAppStoreAuthorizeEventSchema>;
