/**
 * The voice tool dispatcher only says what is true (SW-23, SW-24):
 *  - lookup_order queries Salla with a documented filter (reference_id or keyword) and speaks
 *    only an order whose customer phone equals the caller id Twilio verified — never data[0];
 *  - bookings / hand-overs are validated, then confirmed only when saved; a failed save is an
 *    honest line, a missing field makes the agent ask for it;
 *  - lines follow the merchant's dialect.
 */
import { describe, expect, it, vi } from "vitest";
import { dispatchVoiceTool, type VoiceToolContext } from "@/lib/voice/agent";
import { normalizePhoneE164 } from "@/lib/voice/phone";
import { SallaConnectionError } from "@/lib/salla/tokens";

const CALLER = "+966551234567";

/** The documented GET /orders example (docs.salla.dev/orders/list.md): orders of two other customers first. */
const ordersPage = {
  data: [
    { id: 1333249299, reference_id: 275839672, status: { name: "قيد التنفيذ" }, date: { date: "2026-10-30 10:00:00.000000" }, customer: { mobile: 557777777, mobile_code: "+966" } },
    { id: 1333249300, reference_id: 281659564, status: { name: "تم التوصيل" }, date: { date: "2026-10-31 10:00:00.000000" }, customer: { mobile: 553333333, mobile_code: "+966" } },
    { id: 1333249301, reference_id: 290000001, status: { name: "تم الشحن" }, date: { date: "2026-11-01 09:00:00.000000" }, customer: { mobile: 551234567, mobile_code: "+966" } },
    { id: 1333249302, reference_id: 290000002, status: { name: "بانتظار الدفع" }, date: { date: "2026-11-02 09:00:00.000000" }, customer: { mobile: "0551234567", mobile_code: "+966" } }
  ]
};

function ctx(over: Partial<VoiceToolContext> = {}): VoiceToolContext & { salla: ReturnType<typeof vi.fn> } {
  return {
    merchantId: "m-1",
    persona: { merchantId: "m-1", storeName: "متجر", dialect: "khaliji", escalationPhone: "+966112223333" },
    callerNumber: CALLER,
    salla: vi.fn(async () => ordersPage),
    recordBooking: vi.fn(async () => "b7f3c2d1-0000-4000-8000-000000000001"),
    recordEscalation: vi.fn(async () => "e1111111-0000-4000-8000-000000000001"),
    ...over
  } as never;
}

describe("lookup_order (SW-23)", () => {
  it("by the caller's number: keyword filter, newest order OF THE CALLER (not data[0])", async () => {
    const c = ctx();
    const out = await dispatchVoiceTool({ name: "lookup_order", arguments: {} }, c);
    expect(c.salla).toHaveBeenCalledWith("/orders?keyword=551234567&sort_by=created_at-desc&per_page=30");
    expect(out).toEqual({ output: "حالة الطلب: بانتظار الدفع.", outcome: "ok" });
  });

  it("a spoken number never widens the lookup: only the verified caller id counts", async () => {
    const c = ctx();
    const out = await dispatchVoiceTool({ name: "lookup_order", arguments: { mobile: "0557777777" } }, c);
    expect(c.salla).toHaveBeenCalledWith("/orders?keyword=551234567&sort_by=created_at-desc&per_page=30");
    expect(out.output).toBe("حالة الطلب: بانتظار الدفع.");
  });

  it("no order of the caller → not found, even though the store has orders", async () => {
    const c = ctx({ callerNumber: "+966509999999" });
    const out = await dispatchVoiceTool({ name: "lookup_order", arguments: {} }, c);
    expect(out.outcome).toBe("not_found");
    expect(out.output).toContain("ما لقيت طلباً");
    expect(out.output).not.toMatch(/قيد التنفيذ|تم التوصيل|تم الشحن/);
  });

  it("by order number: reference_id filter, answered only when the order is the caller's", async () => {
    const theirs = ctx({ salla: vi.fn(async () => ({ data: [ordersPage.data[0]] })) as never });
    const refused = await dispatchVoiceTool({ name: "lookup_order", arguments: { orderNumber: "275839672" } }, theirs);
    expect(theirs.salla).toHaveBeenCalledWith("/orders?reference_id=275839672");
    expect(refused.outcome).toBe("not_found");

    const mine = ctx({ salla: vi.fn(async () => ({ data: [ordersPage.data[2]] })) as never });
    const ok = await dispatchVoiceTool({ name: "lookup_order", arguments: { orderNumber: "#٢٩٠٠٠٠٠٠١" } }, mine);
    expect(mine.salla).toHaveBeenCalledWith("/orders?reference_id=290000001");
    expect(ok).toEqual({ output: "حالة الطلب: تم الشحن.", outcome: "ok" });
  });

  it("number formats 05…, 9665… and +9665… resolve to the same query and match", async () => {
    for (const raw of ["0551234567", "966551234567", "+966551234567", "٠٥٥١٢٣٤٥٦٧"]) {
      const c = ctx({ callerNumber: normalizePhoneE164(raw) });
      const out = await dispatchVoiceTool({ name: "lookup_order", arguments: {} }, c);
      expect(c.salla).toHaveBeenCalledWith("/orders?keyword=551234567&sort_by=created_at-desc&per_page=30");
      expect(out.output).toBe("حالة الطلب: بانتظار الدفع.");
    }
    // the order side: mobile 551234567 / "0551234567" with +966 both belong to +966551234567
    const c = ctx({ salla: vi.fn(async () => ({ data: [ordersPage.data[3]] })) as never });
    expect((await dispatchVoiceTool({ name: "lookup_order", arguments: { orderNumber: "290000002" } }, c)).outcome).toBe("ok");
  });

  it("without a verified caller (withheld number / unknown call) nothing is looked up", async () => {
    const c = ctx({ callerNumber: null });
    const out = await dispatchVoiceTool({ name: "lookup_order", arguments: { orderNumber: "290000001" } }, c);
    expect(c.salla).not.toHaveBeenCalled();
    expect(out.outcome).toBe("unverified_caller");
  });

  it("an order number that is not a number is asked again, not sent to Salla", async () => {
    const c = ctx();
    const out = await dispatchVoiceTool({ name: "lookup_order", arguments: { orderNumber: "abc'; drop" } }, c);
    expect(c.salla).not.toHaveBeenCalled();
    expect(out.outcome).toBe("needs_input");
  });

  it("a disconnected store says so; other failures are a generic line", async () => {
    const gone = ctx({ salla: vi.fn(async () => Promise.reject(new SallaConnectionError(409, "x", "salla_not_connected"))) as never });
    expect((await dispatchVoiceTool({ name: "lookup_order", arguments: {} }, gone)).outcome).toBe("store_not_connected");
    const broken = ctx({ salla: vi.fn(async () => Promise.reject(new Error("500"))) as never });
    const out = await dispatchVoiceTool({ name: "lookup_order", arguments: {} }, broken);
    expect(out.outcome).toBe("failed");
    expect(out.output).not.toContain("أحوّلك");
  });

  it("speaks MSA / English for those lines", async () => {
    const msa = await dispatchVoiceTool({ name: "lookup_order", arguments: {} }, ctx({ persona: { merchantId: "m-1", storeName: "س", dialect: "msa" }, callerNumber: "+966509999999" }));
    expect(msa.output).toContain("لم أجد طلباً");
    const en = await dispatchVoiceTool({ name: "lookup_order", arguments: {} }, ctx({ persona: { merchantId: "m-1", storeName: "S", dialect: "english" } }));
    expect(en.output).toBe("Order status: بانتظار الدفع.");
  });
});

describe("book_appointment (SW-24)", () => {
  it("asks for a missing name / time instead of saving", async () => {
    const c = ctx();
    expect((await dispatchVoiceTool({ name: "book_appointment", arguments: { preferredTime: "الخميس ٥ م" } }, c)).outcome).toBe("needs_input");
    expect((await dispatchVoiceTool({ name: "book_appointment", arguments: { name: "سارة" } }, c)).outcome).toBe("needs_input");
    expect(c.recordBooking).not.toHaveBeenCalled();
  });

  it("uses the caller's verified number when no mobile is given; asks when there is none", async () => {
    const c = ctx();
    const out = await dispatchVoiceTool({ name: "book_appointment", arguments: { name: "سارة", preferredTime: "الخميس ٥ م" } }, c);
    expect(c.recordBooking).toHaveBeenCalledWith({ name: "سارة", mobile: CALLER, preferredTime: "الخميس ٥ م", note: undefined });
    expect(out).toMatchObject({ outcome: "ok", bookingId: "b7f3c2d1-0000-4000-8000-000000000001" });
    expect(out.output).toContain("رقم الطلب b7f3c2d1");
    expect(out.output).toContain("فريق المتجر بيتواصل معك لتأكيد الموعد");
    expect(out.output).not.toContain("رسالة");

    const hidden = ctx({ callerNumber: null });
    expect((await dispatchVoiceTool({ name: "book_appointment", arguments: { name: "سارة", preferredTime: "غداً" } }, hidden)).output).toContain("أحتاج رقم جوال");
    expect(hidden.recordBooking).not.toHaveBeenCalled();
  });

  it("normalises a spoken mobile and rejects one that cannot be dialled", async () => {
    const c = ctx();
    await dispatchVoiceTool({ name: "book_appointment", arguments: { name: "Sara", mobile: "٠٥٥ ٥٥٥ ١٢١٢", preferredTime: "5pm" } }, c);
    expect(c.recordBooking).toHaveBeenCalledWith(expect.objectContaining({ mobile: "+966555551212" }));
    const bad = await dispatchVoiceTool({ name: "book_appointment", arguments: { name: "Sara", mobile: "12", preferredTime: "5pm" } }, ctx());
    expect(bad.outcome).toBe("needs_input");
  });

  it("a failed save is never announced as booked", async () => {
    const c = ctx({ recordBooking: vi.fn(async () => null) });
    const out = await dispatchVoiceTool({ name: "book_appointment", arguments: { name: "Sara", preferredTime: "5pm" } }, c);
    expect(out.outcome).toBe("failed");
    expect(out.output).not.toContain("سجّلت");
    expect(out.output).toContain("ما قدرت أسجّل الحجز");
    expect(out.output).toContain("+966112223333");
  });
});

describe("escalate_to_human (SW-24)", () => {
  it("records the hand-over with the verified caller as callback number and promises a callback, not a transfer", async () => {
    const c = ctx();
    const out = await dispatchVoiceTool({ name: "escalate_to_human", arguments: { reason: "شكوى", summary: "تأخر الطلب" } }, c);
    expect(c.recordEscalation).toHaveBeenCalledWith({ reason: "شكوى", summary: "تأخر الطلب", callbackNumber: CALLER });
    expect(out.outcome).toBe("ok");
    expect(out.output).toContain("بيتواصلون معك على رقمك");
    expect(out.output).not.toContain("حالاً");
  });

  it("asks for a number when the caller id is hidden", async () => {
    const c = ctx({ callerNumber: null });
    const out = await dispatchVoiceTool({ name: "escalate_to_human", arguments: { reason: "استرجاع" } }, c);
    expect(c.recordEscalation).toHaveBeenCalledWith({ reason: "استرجاع", summary: undefined, callbackNumber: null });
    expect(out.output).toContain("قل لي رقم جوالك");
  });

  it("a failed record says so (and offers the store's own number)", async () => {
    const out = await dispatchVoiceTool({ name: "escalate_to_human", arguments: { reason: "x" } }, ctx({ recordEscalation: vi.fn(async () => null) }));
    expect(out.outcome).toBe("failed");
    expect(out.output).toContain("ما قدرت أسجّل طلبك");
    expect(out.output).toContain("+966112223333");
  });

  it("needs a reason", async () => {
    const c = ctx();
    expect((await dispatchVoiceTool({ name: "escalate_to_human", arguments: {} }, c)).outcome).toBe("needs_input");
    expect(c.recordEscalation).not.toHaveBeenCalled();
  });
});
