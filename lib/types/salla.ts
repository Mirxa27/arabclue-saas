import { z } from "zod";

/** Salla Admin API — paginated list wrapper */
export const SallaListResponseSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    data: z.array(item).optional(),
    pagination: z
      .object({
        currentPage: z.number().optional(),
        totalPages: z.number().optional()
      })
      .optional()
  });

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

export const SallaOrderStatusSchema = z.object({
  name: z.string().optional()
});

export const SallaOrderSchema = z.object({
  id: z.union([z.number(), z.string()]),
  created_at: z.string().optional(),
  status: SallaOrderStatusSchema.optional(),
  shipment: z.unknown().optional().nullable(),
  customer: z
    .object({
      name: z.string().optional(),
      vat_number: z.string().optional()
    })
    .optional()
    .nullable(),
  items: z
    .array(
      z.object({
        name: z.string(),
        quantity: z.number().optional(),
        price: z.union([z.number(), z.string()]).optional()
      })
    )
    .optional()
});

export type SallaOrder = z.infer<typeof SallaOrderSchema>;

export const SallaOrdersResponseSchema = SallaListResponseSchema(SallaOrderSchema);

export const SallaOrderCreatedEventSchema = z.object({
  event: z.literal("order.created"),
  merchant: z.union([z.number(), z.string()]),
  created_at: z.string().optional(),
  data: SallaOrderSchema
});

export type SallaOrderCreatedEvent = z.infer<typeof SallaOrderCreatedEventSchema>;
