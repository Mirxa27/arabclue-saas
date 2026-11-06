import { z } from "zod";

/** Anonymous analytics: small, flat, primitive-only props (F32 — the endpoint is unauthenticated). */
export const ANALYTICS_MAX_BODY_BYTES = 4096;
const MAX_PROPS = 20;

const PropValue = z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()]);

export const AnalyticsBodySchema = z.object({
  name: z.string().min(1).max(80).regex(/^[a-z0-9._-]+$/i),
  props: z
    .record(z.string().min(1).max(40).regex(/^[a-zA-Z0-9_.-]+$/), PropValue)
    .refine((p) => Object.keys(p).length <= MAX_PROPS, { message: `at most ${MAX_PROPS} props` })
    .optional(),
  sessionId: z.string().max(64).optional()
});
