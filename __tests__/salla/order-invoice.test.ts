/**
 * critic-2 — Salla order.* payloads mapped onto the invoice input of lib/zatca/invoice.ts, tested
 * against the documented samples in __tests__/fixtures (see the README there for sources):
 * line prices from items[].amounts.price_without_tax, order-level shipping / COD / discounts,
 * the issue date from data.date in Asia/Riyadh, the buyer from first/last name — and the
 * generated invoice total equals data.amounts.total.
 */
import { describe, expect, it } from "vitest";
import orderCreated from "../fixtures/salla-order-created.json";
import orderStatusUpdated from "../fixtures/salla-order-status-updated.json";
import invoiceCreated from "../fixtures/salla-invoice-created.json";
import { SallaOrderCreatedEventSchema, SallaOrderSchema, type SallaOrder } from "@/lib/types/salla";
import {
  mapSallaOrderToInvoice,
  sallaDateToInstant,
  SALLA_COD_LINE_NAME,
  SALLA_SHIPPING_LINE_NAME,
  type SallaOrderInvoice
} from "@/lib/salla/order-invoice";
import { generateInvoice } from "@/lib/zatca/invoice";

const SELLER = {
  name: "Bait Al Oud",
  vatNumber: "300000000000003",
  address: { street: "King Fahd Rd", building: "1234", city: "Riyadh", postalCode: "12211" }
};

function invoiceFor(mapped: SallaOrderInvoice) {
  return generateInvoice({
    invoiceNumber: `INV-${mapped.orderId}`,
    issueDate: mapped.issueDate,
    icv: 1,
    seller: SELLER,
    buyer: mapped.buyer,
    lines: mapped.lines
  });
}

function mapOk(order: SallaOrder): SallaOrderInvoice {
  const result = mapSallaOrderToInvoice(order);
  if (!result.ok) throw new Error(`mapping failed: ${result.reason} ${JSON.stringify(result.detail)}`);
  return result.invoice;
}

/** The documented order.created order with some fields replaced. */
function documentedOrder(patch: (o: Record<string, any>) => void = () => undefined): SallaOrder {
  const raw = structuredClone(orderCreated.data) as Record<string, any>;
  patch(raw);
  return SallaOrderSchema.parse(raw);
}

describe("documented order.created sample (docs.salla.dev/doc-433804)", () => {
  it("parses with the zod schema", () => {
    const evt = SallaOrderCreatedEventSchema.parse(orderCreated);
    expect(evt.data.amounts.total.amount).toBe(196);
    expect(evt.data.items[0].amounts.price_without_tax.amount).toBe(186);
    expect(evt.data.amounts.discounts?.[0].discount).toBe(5); // documented as the string "5.00"
    expect(evt.data.amounts.tax.percent).toBe(0); // documented as the string "0.00"
  });

  it("maps to an invoice whose total equals data.amounts.total", () => {
    const evt = SallaOrderCreatedEventSchema.parse(orderCreated);
    const mapped = mapOk(evt.data);
    const invoice = invoiceFor(mapped);

    expect(invoice.totals.total).toBe(orderCreated.data.amounts.total.amount); // 196
    expect(invoice.totals.subtotal).toBe(196);
    expect(invoice.totals.vat).toBe(0);
    expect(mapped.roundingDifference).toBe(0);
    expect(mapped.lines).toEqual([
      { name: "بيتزا", quantity: 1, unitPrice: 181, vatRate: 0 }, // 186 − the 5 SAR offer
      { name: SALLA_SHIPPING_LINE_NAME, quantity: 1, unitPrice: 15, vatRate: 0 }
    ]);
    expect(mapped.breakdown).toMatchObject({ subTotal: 186, discount: 5, tax: 0, total: 196, shipping: { amount: 15 } });
    expect(mapped.breakdown.items[0]).toMatchObject({ unitPrice: 186, discount: 5, sku: "54534534" });
  });

  it("issues on data.date read in Asia/Riyadh and bills the customer by first + last name", () => {
    const mapped = mapOk(SallaOrderCreatedEventSchema.parse(orderCreated).data);
    expect(mapped.issueDate.toISOString()).toBe("2022-06-26T09:21:45.000Z"); // 12:21:45 +03:00
    expect(mapped.buyer).toEqual({ name: "Mohammed Ali" });
    expect(mapped.orderId).toBe("2116149737");
    expect(mapped.referenceId).toBe("41027662");
  });

  it("no longer produces zero-priced lines: the old hand-written shape fails validation instead", () => {
    const legacy = { event: "order.created", merchant: 1, data: { id: 1, created_at: "2024-01-01", items: [{ name: "x", price: 100 }] } };
    expect(SallaOrderCreatedEventSchema.safeParse(legacy).success).toBe(false);
  });
});

describe("other documented order models", () => {
  it("order.status.updated: Salla's per-item discount split, shipping and COD lines, customer.name", () => {
    const order = SallaOrderSchema.parse(orderStatusUpdated.data.order);
    const mapped = mapOk(order);
    const invoice = invoiceFor(mapped);

    expect(invoice.totals.total).toBe(orderStatusUpdated.data.order.amounts.total.amount); // 154
    expect(mapped.lines).toEqual([
      expect.objectContaining({ quantity: 1, unitPrice: 120 }),
      expect.objectContaining({ quantity: 1, unitPrice: 0 }), // the free loyalty-prize item
      { name: SALLA_SHIPPING_LINE_NAME, quantity: 1, unitPrice: 33, vatRate: 0 },
      { name: SALLA_COD_LINE_NAME, quantity: 1, unitPrice: 1, vatRate: 0 }
    ]);
    expect(mapped.warnings).not.toContain("discount_split_pro_rata");
    expect(mapped.buyer).toEqual({ name: "Test Salla" });
  });

  it("15% VAT, quantity 4 and a discount (figures of the documented invoice.created sample)", () => {
    const line = invoiceCreated.items[0];
    const order = documentedOrder((o) => {
      o.items = [
        {
          id: line.item_id,
          name: line.name,
          sku: line.sku,
          quantity: line.quantity,
          amounts: {
            price_without_tax: { amount: line.price.amount, currency: "SAR" },
            total_discount: { amount: line.discount.amount, currency: "SAR" },
            tax: { percent: "15.00", amount: { amount: line.tax.amount.amount, currency: "SAR" } },
            total: { amount: line.total.amount, currency: "SAR" }
          }
        }
      ];
      o.amounts = {
        sub_total: invoiceCreated.sub_total,
        shipping_cost: { amount: invoiceCreated.shipping_cost.amount, currency: "SAR" },
        cash_on_delivery: { amount: invoiceCreated.cod_cost.amount, currency: "SAR" },
        tax: { percent: "15.00", amount: invoiceCreated.tax.amount },
        discounts: [{ title: "coupon", type: "normal", code: "C", discount: String(invoiceCreated.discount.amount) }],
        total: invoiceCreated.total
      };
    });

    const mapped = mapOk(order);
    const invoice = invoiceFor(mapped);
    expect(invoice.totals.total).toBe(invoiceCreated.total.amount); // 911.97
    expect(invoice.totals.vat).toBe(invoiceCreated.tax.amount.amount); // 118.95
    expect(invoice.totals.subtotal).toBe(793.02); // 834.76 − 41.74
    expect(mapped.lines[0]).toMatchObject({ quantity: 4, vatRate: 0.15 });
    expect(mapped.warnings).toContain("unit_price_below_halala"); // 793.02 / 4 needs an allowance element
  });
});

describe("shipping, discounts and VAT", () => {
  const order = (amounts: Record<string, unknown>, items: Array<Record<string, unknown>>) =>
    documentedOrder((o) => {
      o.amounts = amounts;
      o.items = items;
    });
  const item = (name: string, price: number, quantity = 1, extra: Record<string, unknown> = {}) => ({
    name,
    quantity,
    amounts: { price_without_tax: { amount: price }, tax: { percent: "15.00", amount: { amount: 0 } }, ...extra }
  });
  const money = (amount: number) => ({ amount, currency: "SAR" });

  it("taxes shipping at the order rate when that reproduces Salla's tax", () => {
    const mapped = mapOk(
      order({ sub_total: money(100), shipping_cost: money(20), tax: { percent: "15.00", amount: money(18) }, total: money(138) }, [
        item("Oud", 100)
      ])
    );
    const invoice = invoiceFor(mapped);
    expect(invoice.totals).toEqual({ subtotal: 120, vat: 18, total: 138 });
    expect(mapped.lines[1]).toEqual({ name: SALLA_SHIPPING_LINE_NAME, quantity: 1, unitPrice: 20, vatRate: 0.15 });
  });

  it("leaves shipping untaxed when only that reading reproduces Salla's tax", () => {
    const mapped = mapOk(
      order({ sub_total: money(100), shipping_cost: money(20), tax: { percent: "15.00", amount: money(15) }, total: money(135) }, [
        item("Oud", 100)
      ])
    );
    expect(invoiceFor(mapped).totals.total).toBe(135);
    expect(mapped.warnings).toContain("shipping_not_taxed");
  });

  it("splits a discount pro rata when Salla gives no per-item split, exactly to the halala", () => {
    const mapped = mapOk(
      order(
        {
          sub_total: money(100),
          tax: { percent: "15.00", amount: money(13.5) },
          discounts: [{ title: "10 off", discount: "10.00", discounted_shipping: "0.00" }],
          total: money(103.5)
        },
        [item("A", 60), item("B", 40)]
      )
    );
    expect(mapped.lines.map((l) => l.unitPrice)).toEqual([54, 36]);
    expect(invoiceFor(mapped).totals.total).toBe(103.5);
    expect(mapped.warnings).toContain("discount_split_pro_rata");
  });

  it("accepts price_without_tax as a line total when only that reproduces sub_total", () => {
    const mapped = mapOk(
      order({ sub_total: money(100), tax: { percent: "15.00", amount: money(15) }, total: money(115) }, [item("Pair", 100, 2)])
    );
    expect(mapped.lines[0]).toMatchObject({ quantity: 2, unitPrice: 50 });
    expect(mapped.warnings).toContain("item_price_is_line_total");
    expect(invoiceFor(mapped).totals.total).toBe(115);
  });

  it("treats price_without_tax as a unit price when both readings agree (quantity 1) or the unit one fits", () => {
    const mapped = mapOk(
      order({ sub_total: money(200), tax: { percent: "15.00", amount: money(30) }, total: money(230) }, [item("Pair", 100, 2)])
    );
    expect(mapped.lines[0]).toMatchObject({ quantity: 2, unitPrice: 100 });
    expect(mapped.warnings).not.toContain("item_price_is_line_total");
  });
});

describe("refuses orders it cannot invoice faithfully", () => {
  const reason = (order: SallaOrder) => {
    const result = mapSallaOrderToInvoice(order);
    return result.ok ? "ok" : result.reason;
  };

  it("draft orders and non-SAR orders", () => {
    expect(reason(documentedOrder((o) => (o.draft = true)))).toBe("draft_order");
    expect(reason(documentedOrder((o) => (o.currency = "USD")))).toBe("unsupported_currency");
  });

  it("items that do not add up to sub_total, totals that do not reconcile, VAT that does not reconcile", () => {
    expect(reason(documentedOrder((o) => (o.amounts.sub_total.amount = 999)))).toBe("items_do_not_match_subtotal");
    expect(reason(documentedOrder((o) => (o.amounts.total.amount = 250)))).toBe("totals_do_not_reconcile");
    expect(
      reason(
        documentedOrder((o) => {
          o.amounts.tax = { percent: "15.00", amount: { amount: 50, currency: "SAR" } };
          o.amounts.total.amount = 246;
        })
      )
    ).toBe("vat_does_not_reconcile");
  });

  it("unparseable dates and empty orders", () => {
    expect(reason(documentedOrder((o) => (o.date.date = "2022-13-40 99:00:00")))).toBe("invalid_date");
    expect(reason(documentedOrder((o) => (o.items = [])))).toBe("no_items");
  });

  it("returns the reason with non-PII detail for the events log", () => {
    const result = mapSallaOrderToInvoice(documentedOrder((o) => (o.amounts.total.amount = 250)));
    expect(result).toMatchObject({ ok: false, detail: { order_id: "2116149737", total: 250, discounts: 5 } });
  });
});

describe("sallaDateToInstant", () => {
  const at = (date: string, timezone?: string) => sallaDateToInstant({ date, timezone_type: 3, timezone })?.date.toISOString();

  it("reads the wall clock in the given zone", () => {
    expect(at("2022-06-26 12:21:45.000000", "Asia/Riyadh")).toBe("2022-06-26T09:21:45.000Z");
    expect(at("2022-06-26 12:21:45.000000", "Asia/Dubai")).toBe("2022-06-26T08:21:45.000Z");
    expect(at("2022-06-26 12:21:45", "+04:00")).toBe("2022-06-26T08:21:45.000Z");
    expect(at("2022-06-26 00:30:00.000000", "UTC")).toBe("2022-06-26T00:30:00.000Z");
  });

  it("defaults to Asia/Riyadh and falls back to it for unknown zones", () => {
    expect(at("2022-06-26 00:30:00.000000")).toBe("2022-06-25T21:30:00.000Z"); // previous UTC day
    expect(sallaDateToInstant({ date: "2022-06-26 12:00:00", timezone: "Mars/Olympus" })).toMatchObject({ zoneFallback: true });
    expect(at("2022-06-26 12:00:00", "Mars/Olympus")).toBe("2022-06-26T09:00:00.000Z");
  });

  it("rejects malformed or impossible dates", () => {
    expect(sallaDateToInstant({ date: "26/06/2022 12:21" })).toBeNull();
    expect(sallaDateToInstant({ date: "2022-02-30 10:00:00" })).toBeNull();
  });
});
