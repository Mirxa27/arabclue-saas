/**
 * Salla order (order.* webhook model) → the invoice input that lib/zatca/invoice.ts takes today.
 *
 * What the docs say (https://docs.salla.dev/doc-433804 = /webhook-events/orders.md):
 *   items[].amounts.price_without_tax.amount   price before VAT and before order discounts
 *   items[].amounts.total_discount.amount      the item's share of the order discounts
 *   items[].amounts.tax.percent                "15.00"
 *   amounts.sub_total / shipping_cost / cash_on_delivery / tax / discounts[] / total, where every
 *   documented sample satisfies  total = sub_total + shipping + cash_on_delivery + tax − Σ discounts
 *   VAT is charged after the discount: docs.salla.dev/orders/details.md (15 − 0.75) × 15% = 2.14,
 *   webhook-events/invoice.md (834.76 − 41.74) × 15% = 118.95; shipping and COD are `taxable`.
 *   date = { date: "2022-06-26 12:21:45.000000", timezone_type: 3, timezone: "Asia/Riyadh" }
 *
 * The current generator has no allowance (discount) element, so order discounts are folded into
 * the item lines' net prices — Salla's own per-item `total_discount` split when it adds up,
 * otherwise pro rata — and shipping / cash-on-delivery become their own lines. `breakdown` keeps
 * the documented figures for an allowance-based generator. The mapping refuses (`ok: false`)
 * whenever its lines would not reproduce Salla's own tax and total: an invoice that disagrees with
 * the order is worse than none.
 */
import { computeTotals, type BuyerInfo, type InvoiceLine } from "@/lib/zatca/invoice";
import type { SallaDate, SallaOrder } from "@/lib/types/salla";

export const SALLA_DEFAULT_TIMEZONE = "Asia/Riyadh";
export const SALLA_SHIPPING_LINE_NAME = "رسوم الشحن";
export const SALLA_COD_LINE_NAME = "رسوم الدفع عند الاستلام";

export type SallaOrderMappingFailure =
  | "draft_order"
  | "unsupported_currency"
  | "no_items"
  | "invalid_date"
  | "invalid_amounts"
  | "items_do_not_match_subtotal"
  | "totals_do_not_reconcile"
  | "discount_exceeds_items"
  | "vat_does_not_reconcile";

export type SallaOrderMappingWarning =
  | "item_price_is_line_total"
  | "discount_split_pro_rata"
  | "unit_price_below_halala"
  | "shipping_not_taxed"
  | "rounding_difference"
  | "unknown_timezone";

export type SallaInvoiceItem = {
  name: string;
  sku: string | null;
  quantity: number;
  /** Before VAT and before order discounts (SAR). */
  unitPrice: number;
  /** This line's share of the order discounts, before VAT (SAR). */
  discount: number;
  vatRate: number;
};

export type SallaOrderInvoice = {
  orderId: string;
  referenceId: string | null;
  /** The order's instant (data.date read in its timezone, Asia/Riyadh by default). */
  issueDate: Date;
  /** Simplified (B2C) invoice buyer: the customer's name. Salla's order payload has no buyer VAT number. */
  buyer?: BuyerInfo;
  /** Input for generateInvoice(): items net of discounts, then shipping and cash-on-delivery lines. */
  lines: InvoiceLine[];
  breakdown: {
    items: SallaInvoiceItem[];
    shipping: { amount: number; vatRate: number } | null;
    cashOnDelivery: { amount: number; vatRate: number } | null;
    discount: number;
    subTotal: number;
    tax: number;
    total: number;
    currency: "SAR";
  };
  /** generateInvoice total minus Salla's amounts.total, in SAR (0 when exact; within VAT rounding otherwise). */
  roundingDifference: number;
  warnings: SallaOrderMappingWarning[];
};

export type SallaOrderMapping =
  | { ok: true; invoice: SallaOrderInvoice }
  | { ok: false; reason: SallaOrderMappingFailure; detail: Record<string, string | number | boolean | null> };

// ── money in halalas ───────────────────────────────────────────────────────

/** SAR → integer halalas (half-up; immune to binary noise such as 208.69 × 100). */
function toHalalas(sar: number): number {
  return Math.round(sar * 100 + (sar >= 0 ? 1e-7 : -1e-7));
}
const toSar = (halalas: number) => halalas / 100;
const sumOf = (values: number[]) => values.reduce((s, v) => s + v, 0);

/** Split `total` over `weights` pro rata in whole units, exactly (largest remainder). */
function allocateProRata(total: number, weights: number[]): number[] {
  const weightSum = sumOf(weights);
  if (total === 0 || weightSum === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / weightSum);
  const shares = raw.map((r) => Math.floor(r));
  let rest = total - sumOf(shares);
  const byRemainder = raw.map((r, i) => ({ i, frac: r - shares[i] })).sort((x, y) => y.frac - x.frac || x.i - y.i);
  for (const { i } of byRemainder) {
    if (rest <= 0) break;
    shares[i] += 1;
    rest -= 1;
  }
  return shares;
}

// ── dates ──────────────────────────────────────────────────────────────────

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/;
const FIXED_OFFSET = /^(?:UTC|GMT)?([+-])(\d{2}):?(\d{2})$/;

function offsetAtInstant(timeZone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - Math.floor(instant / 1000) * 1000;
}

/** UTC offset (ms) of `zone` for the instant whose local wall clock reads `wallUtc`. */
function zoneOffset(zone: string, wallUtc: number): number {
  const fixed = FIXED_OFFSET.exec(zone);
  if (fixed) return (fixed[1] === "-" ? -1 : 1) * (Number(fixed[2]) * 60 + Number(fixed[3])) * 60_000;
  if (zone === "UTC" || zone === "Z" || zone === "GMT") return 0;
  const first = offsetAtInstant(zone, wallUtc);
  return offsetAtInstant(zone, wallUtc - first);
}

/**
 * Salla's `{ date, timezone }` (a wall-clock time in that zone) as an instant. A missing zone means
 * Asia/Riyadh (UTC+3, no DST); an unknown one falls back to it with `zoneFallback`.
 */
export function sallaDateToInstant(value: SallaDate): { date: Date; zoneFallback: boolean } | null {
  const m = WALL_CLOCK.exec(value.date.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = "0", frac = "0"] = m;
  const wallUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(frac.padEnd(3, "0").slice(0, 3)));
  const check = new Date(wallUtc);
  if (
    check.getUTCFullYear() !== Number(y) ||
    check.getUTCMonth() !== Number(mo) - 1 ||
    check.getUTCDate() !== Number(d) ||
    check.getUTCHours() !== Number(h) ||
    check.getUTCMinutes() !== Number(mi)
  ) {
    return null;
  }
  const zone = value.timezone?.trim() || SALLA_DEFAULT_TIMEZONE;
  try {
    return { date: new Date(wallUtc - zoneOffset(zone, wallUtc)), zoneFallback: false };
  } catch {
    return { date: new Date(wallUtc - zoneOffset(SALLA_DEFAULT_TIMEZONE, wallUtc)), zoneFallback: true };
  }
}

// ── buyer ──────────────────────────────────────────────────────────────────

function buyerName(customer: SallaOrder["customer"]): string | null {
  if (!customer) return null;
  const parts = [customer.first_name, customer.last_name].map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  const name = parts.length ? parts.join(" ") : customer.name?.trim();
  return name ? name.slice(0, 200) : null;
}

// ── mapping ────────────────────────────────────────────────────────────────

export function mapSallaOrderToInvoice(order: SallaOrder): SallaOrderMapping {
  const orderId = String(order.id);
  const fail = (reason: SallaOrderMappingFailure, detail: Record<string, string | number | boolean | null> = {}): SallaOrderMapping => ({
    ok: false,
    reason,
    detail: { order_id: orderId, ...detail }
  });
  const warnings: SallaOrderMappingWarning[] = [];

  if (order.draft === true) return fail("draft_order");
  const currency = (order.currency ?? order.amounts.total.currency ?? "SAR").trim().toUpperCase();
  if (currency !== "SAR") return fail("unsupported_currency", { currency });
  if (order.items.length === 0) return fail("no_items");

  const issued = sallaDateToInstant(order.date);
  if (!issued) return fail("invalid_date");
  if (issued.zoneFallback) warnings.push("unknown_timezone");

  const a = order.amounts;
  const subTotal = toHalalas(a.sub_total.amount);
  const shipping = toHalalas(a.shipping_cost?.amount ?? 0);
  const cod = toHalalas(a.cash_on_delivery?.amount ?? 0);
  const tax = toHalalas(a.tax.amount.amount);
  const total = toHalalas(a.total.amount);
  const orderRate = a.tax.percent / 100;
  const itemRates = order.items.map((it) => (it.amounts.tax ? it.amounts.tax.percent / 100 : orderRate));
  const prices = order.items.map((it) => toHalalas(it.amounts.price_without_tax.amount));
  const quantities = order.items.map((it) => it.quantity);
  if (
    [subTotal, shipping, cod, tax, total, ...prices].some((v) => !Number.isFinite(v) || v < 0) ||
    [orderRate, ...itemRates].some((r) => !(r >= 0 && r <= 1))
  ) {
    return fail("invalid_amounts");
  }

  // 1. Items vs sub_total. Every documented sample has quantity 1, so take price_without_tax as a
  //    unit price — or as the line total if only that reproduces sub_total.
  const asUnit = prices.map((p, i) => Math.round(p * quantities[i]));
  const asLine = prices;
  const itemTolerance = Math.ceil(sumOf(quantities) / 2); // ≤ ½ halala of rounding per unit
  let gross: number[];
  if (Math.abs(sumOf(asUnit) - subTotal) <= itemTolerance) {
    gross = asUnit;
  } else if (Math.abs(sumOf(asLine) - subTotal) <= itemTolerance) {
    gross = asLine;
    warnings.push("item_price_is_line_total");
  } else {
    return fail("items_do_not_match_subtotal", {
      sub_total: toSar(subTotal),
      items_as_unit_prices: toSar(sumOf(asUnit)),
      items_as_line_totals: toSar(sumOf(asLine))
    });
  }

  // 2. The discount that makes Salla's own formula hold. `discounted_shipping` is already netted
  //    out of shipping_cost.amount, so it may or may not be part of `discount`: accept either reading
  //    only when it reproduces amounts.total.
  const discounts = a.discounts ?? [];
  const listed = sumOf(discounts.map((d) => toHalalas(d.discount)));
  const onShipping = sumOf(discounts.map((d) => toHalalas(d.discounted_shipping ?? 0)));
  const implied = subTotal + shipping + cod + tax - total;
  const discount = [listed, listed - onShipping].find((d) => d >= 0 && Math.abs(d - implied) <= 1);
  if (discount === undefined) {
    return fail("totals_do_not_reconcile", {
      sub_total: toSar(subTotal),
      shipping: toSar(shipping),
      cash_on_delivery: toSar(cod),
      tax: toSar(tax),
      discounts: toSar(listed),
      total: toSar(total)
    });
  }
  if (discount > sumOf(gross)) return fail("discount_exceeds_items", { discount: toSar(discount), items: toSar(sumOf(gross)) });

  // 3. Each line's share of the discount: Salla's per-item total_discount when it adds up to the
  //    order discount (line total, or per unit), otherwise pro rata.
  const itemDiscounts = order.items.map((it) => toHalalas(it.amounts.total_discount?.amount ?? 0));
  const perLine = itemDiscounts;
  const perUnit = itemDiscounts.map((d, i) => Math.round(d * quantities[i]));
  const fits = (split: number[]) => Math.abs(sumOf(split) - discount) <= 1 && split.every((d, i) => d >= 0 && d <= gross[i]);
  let shares: number[];
  if (discount === 0) {
    shares = gross.map(() => 0);
  } else if (fits(perLine)) {
    shares = [...perLine];
  } else if (fits(perUnit)) {
    shares = [...perUnit];
  } else {
    shares = allocateProRata(discount, gross);
    warnings.push("discount_split_pro_rata");
  }
  // absorb a 1-halala difference on the largest line that can take it
  const residual = discount - sumOf(shares);
  if (residual !== 0) {
    const target = gross
      .map((g, i) => ({ i, room: residual > 0 ? g - shares[i] : shares[i] }))
      .filter((x) => x.room >= Math.abs(residual))
      .sort((x, y) => gross[y.i] - gross[x.i])[0];
    if (!target) return fail("discount_exceeds_items", { discount: toSar(discount), items: toSar(sumOf(gross)) });
    shares[target.i] += residual;
  }
  const net = gross.map((g, i) => g - shares[i]);
  if (net.some((n, i) => Number.isInteger(quantities[i]) && n % quantities[i] !== 0)) warnings.push("unit_price_below_halala");

  // 4. Lines for the generator; shipping and COD are taxable at the order rate unless only the
  //    untaxed reading reproduces Salla's tax.
  const lineName = (name: string, i: number) => name.trim() || `Item ${i + 1}`;
  const buildLines = (chargeRate: number): InvoiceLine[] => [
    ...order.items.map((it, i) => ({
      name: lineName(it.name, i),
      quantity: it.quantity,
      unitPrice: toSar(net[i]) / it.quantity,
      vatRate: itemRates[i]
    })),
    ...(shipping > 0 ? [{ name: SALLA_SHIPPING_LINE_NAME, quantity: 1, unitPrice: toSar(shipping), vatRate: chargeRate }] : []),
    ...(cod > 0 ? [{ name: SALLA_COD_LINE_NAME, quantity: 1, unitPrice: toSar(cod), vatRate: chargeRate }] : [])
  ];
  const lineCount = order.items.length + (shipping > 0 ? 1 : 0) + (cod > 0 ? 1 : 0);
  // line-level VAT rounding (generator) vs Salla's order-level rounding: ≤ ½ halala per line + ½
  const tolerance = Math.ceil((lineCount + 1) / 2);
  const chargeRates = shipping > 0 || cod > 0 ? [...new Set([orderRate, 0])] : [orderRate];

  let lastAttempt: { vat: number; total: number } | null = null;
  for (const chargeRate of chargeRates) {
    const lines = buildLines(chargeRate);
    const totals = computeTotals(lines);
    const vatDiff = toHalalas(totals.vat) - tax;
    const totalDiff = toHalalas(totals.total) - total;
    lastAttempt = { vat: totals.vat, total: totals.total };
    if (Math.abs(vatDiff) > tolerance || Math.abs(totalDiff) > tolerance) continue;

    if (chargeRate !== orderRate) warnings.push("shipping_not_taxed");
    if (totalDiff !== 0) warnings.push("rounding_difference");
    const name = buyerName(order.customer);
    return {
      ok: true,
      invoice: {
        orderId,
        referenceId: order.reference_id != null ? String(order.reference_id) : null,
        issueDate: issued.date,
        ...(name ? { buyer: { name } } : {}),
        lines,
        breakdown: {
          items: order.items.map((it, i) => ({
            name: lineName(it.name, i),
            sku: it.sku?.trim() || null,
            quantity: it.quantity,
            unitPrice: toSar(gross[i]) / it.quantity,
            discount: toSar(shares[i]),
            vatRate: itemRates[i]
          })),
          shipping: shipping > 0 ? { amount: toSar(shipping), vatRate: chargeRate } : null,
          cashOnDelivery: cod > 0 ? { amount: toSar(cod), vatRate: chargeRate } : null,
          discount: toSar(discount),
          subTotal: toSar(subTotal),
          tax: toSar(tax),
          total: toSar(total),
          currency: "SAR"
        },
        roundingDifference: toSar(totalDiff),
        warnings
      }
    };
  }

  return fail("vat_does_not_reconcile", {
    salla_tax: toSar(tax),
    salla_total: toSar(total),
    invoice_vat: lastAttempt?.vat ?? null,
    invoice_total: lastAttempt?.total ?? null
  });
}
