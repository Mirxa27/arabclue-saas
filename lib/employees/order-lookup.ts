/**
 * Salla order lookups for an AI employee (SW-3).
 *
 * The merchant-wide Salla token can read every order of the store, so the lookup decides
 * who may see what:
 *   - merchant turns (dashboard chat, the owner's own tasks): any order of the store;
 *   - customer turns (inbound channels): only an order whose customer is the person in the
 *     conversation, proven by the channel's verified identity — the sender's phone number
 *     on WhatsApp / SMS. Channels without a verified phone or email (Telegram, Slack,
 *     Messenger, Instagram, webhook) cannot look orders up at all.
 * An order that is not the contact's answers exactly like an order that does not exist.
 * Only a minimal projection leaves this module (status, shipment tracking, total, dates) —
 * never the customer's name, phone, email or address — so nothing else of the third-party
 * record reaches the model prompt, the stored tool message or the action log.
 * API: GET {SALLA_API_BASE}/orders/{order_id} (docs.salla.dev/orders/details.md) → the order
 * under `data`; the customer fields read here (`customer.mobile`, `mobile_code`, `email`)
 * are the ones the documented order model carries (__tests__/fixtures/salla-order-created.json).
 */
import { z } from "zod";
import { toAsciiDigits } from "@/lib/i18n/digits";
import { SallaApiError } from "@/lib/salla/oauth";
import { sallaApiForMerchant, SallaConnectionError } from "@/lib/salla/tokens";
import { rateLimit } from "@/lib/security/rate-limit";
import type { AIConversationRow, TurnOrigin } from "./types";

export type OrderProjection = {
  order_id: string;
  reference_id: string | null;
  status: string | null;
  status_slug: string | null;
  total: number | null;
  currency: string | null;
  created_at: string | null;
  shipments: Array<{
    status: string | null;
    courier: string | null;
    tracking_number: string | null;
    tracking_link: string | null;
  }>;
};

export type OrderLookupResult = { ok: true; order: OrderProjection } | { ok: false; error: string };

export const ORDER_NOT_FOUND = "No order with that number was found for this customer.";
const LOOKUPS_PER_CONVERSATION = 5;
const LOOKUP_WINDOW_MS = 10 * 60_000;

const Id = z.union([z.number(), z.string().max(64)]);
const Str = z.string().max(500).nullish();

const OrderSchema = z.object({
  id: Id,
  reference_id: Id.nullish(),
  status: z.object({ name: Str, slug: Str }).partial().nullish(),
  amounts: z.object({ total: z.object({ amount: z.union([z.number(), z.string()]).nullish(), currency: Str }).partial().nullish() }).partial().nullish(),
  total: z.object({ amount: z.union([z.number(), z.string()]).nullish(), currency: Str }).partial().nullish(),
  currency: Str,
  date: z.object({ date: Str }).partial().nullish(),
  customer: z
    .object({
      mobile: z.union([z.number(), z.string().max(32)]).nullish(),
      mobile_code: z.string().max(8).nullish(),
      email: z.string().max(320).nullish()
    })
    .partial()
    .nullish(),
  shipments: z
    .array(
      z
        .object({
          status: Str,
          courier_name: Str,
          tracking_number: z.union([z.string().max(200), z.number()]).nullish(),
          tracking_link: Str
        })
        .partial()
    )
    .max(20)
    .nullish()
});

type SallaOrderDetail = z.infer<typeof OrderSchema>;

function digits(value: unknown): string {
  return value === null || value === undefined ? "" : toAsciiDigits(String(value)).replace(/\D/g, "");
}

/** The order customer's phone as international digits (mobile_code + national number). */
export function orderCustomerPhoneDigits(customer: SallaOrderDetail["customer"]): string | null {
  if (!customer) return null;
  const code = digits(customer.mobile_code);
  const national = digits(customer.mobile).replace(/^0+/, "");
  if (!national) return null;
  if (code && national.length >= 11 && national.startsWith(code)) return national; // already international
  return `${code}${national}`;
}

function amount(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function text(v: unknown): string | null {
  if (typeof v === "number") return String(v);
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null;
}

export function projectOrder(order: SallaOrderDetail): OrderProjection {
  const total = order.amounts?.total ?? order.total ?? null;
  return {
    order_id: String(order.id),
    reference_id: order.reference_id === null || order.reference_id === undefined ? null : String(order.reference_id),
    status: text(order.status?.name),
    status_slug: text(order.status?.slug),
    total: amount(total?.amount),
    currency: text(total?.currency) ?? text(order.currency),
    created_at: text(order.date?.date),
    shipments: (order.shipments ?? []).slice(0, 5).map((s) => ({
      status: text(s.status),
      courier: text(s.courier_name),
      tracking_number: text(s.tracking_number),
      tracking_link: text(s.tracking_link)
    }))
  };
}

type LookupConversation = Pick<AIConversationRow, "id" | "channel" | "external_id">;

/** Whether the conversation's contact owns the order. Phone-verified channels only. */
export function orderBelongsToContact(order: SallaOrderDetail, conversation: LookupConversation): boolean {
  const sender = digits(conversation.external_id);
  if (!sender) return false;
  const owner = orderCustomerPhoneDigits(order.customer);
  return owner !== null && owner === sender;
}

const PHONE_VERIFIED_CHANNELS = new Set(["whatsapp", "twilio_sms"]);

export async function lookupOrder(args: {
  merchantId: string;
  orderId: string;
  origin: TurnOrigin;
  conversation: LookupConversation | null;
}): Promise<OrderLookupResult> {
  const orderId = toAsciiDigits(args.orderId.trim()).replace(/^#/, "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(orderId)) return { ok: false, error: ORDER_NOT_FOUND };

  if (args.origin === "inbound_channel") {
    const conv = args.conversation;
    if (!conv || !PHONE_VERIFIED_CHANNELS.has(conv.channel)) {
      return {
        ok: false,
        error:
          "Order details can only be shared with a customer whose phone number this channel verifies (WhatsApp or SMS). Offer to hand the request to the team instead."
      };
    }
    const budget = await rateLimit(`employees:order-lookup:${conv.id}`, LOOKUPS_PER_CONVERSATION, LOOKUP_WINDOW_MS);
    if (!budget.success) return { ok: false, error: "Too many order lookups in this conversation. Offer to hand over to the team." };
  }

  let raw: unknown;
  try {
    raw = await sallaApiForMerchant<unknown>(args.merchantId, `/orders/${encodeURIComponent(orderId)}`);
  } catch (err) {
    if (err instanceof SallaConnectionError) {
      return { ok: false, error: err.code === "salla_not_connected" ? "Salla is not connected for this store." : "The Salla connection needs attention." };
    }
    if (err instanceof SallaApiError) {
      return { ok: false, error: err.status === 404 ? ORDER_NOT_FOUND : `Salla could not be reached (HTTP ${err.status}).` };
    }
    throw err;
  }

  const body = raw && typeof raw === "object" ? (raw as { data?: unknown }).data ?? raw : raw;
  const parsed = OrderSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: ORDER_NOT_FOUND };

  if (args.origin === "inbound_channel" && !orderBelongsToContact(parsed.data, args.conversation as LookupConversation)) {
    return { ok: false, error: ORDER_NOT_FOUND };
  }
  return { ok: true, order: projectOrder(parsed.data) };
}
