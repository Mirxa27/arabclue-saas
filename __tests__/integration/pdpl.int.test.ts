/**
 * Integration test against a real Supabase stack (PostgREST + Postgres).
 * Runs only when SUPABASE_IT_URL and SUPABASE_IT_SERVICE_KEY are set, e.g.
 *   SUPABASE_IT_URL=http://127.0.0.1:54321 SUPABASE_IT_SERVICE_KEY=... npx vitest run __tests__/integration
 * (a local stack: `supabase start` with this repo's migrations).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { buildMerchantExport, eraseMerchantData } from "@/lib/merchant/pdpl";

const URL = process.env.SUPABASE_IT_URL;
const KEY = process.env.SUPABASE_IT_SERVICE_KEY;

describe.skipIf(!URL || !KEY)("PDPL erasure/export on a real stack (F26)", () => {
  let sb: SupabaseClient;
  let userId: string;
  const merchantId = randomUUID();
  const sallaId = `it-salla-${randomUUID().slice(0, 8)}`;
  const cr = `9${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}`;
  let otherUserId: string;
  const otherMerchantId = randomUUID();

  beforeAll(async () => {
    sb = createClient(URL!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const u = await sb.auth.admin.createUser({ email: `pdpl-${randomUUID()}@example.test`, email_confirm: true });
    if (u.error) throw u.error;
    userId = u.data.user!.id;
    const o = await sb.auth.admin.createUser({ email: `pdpl-other-${randomUUID()}@example.test`, email_confirm: true });
    if (o.error) throw o.error;
    otherUserId = o.data.user!.id;

    const ins = async (table: string, rows: unknown) => {
      const { error } = await sb.from(table).insert(rows as never);
      if (error) throw new Error(`${table}: ${error.message}`);
    };
    await ins("merchants", [
      { id: merchantId, owner_user_id: userId, seller_name: "PDPL IT", salla_merchant_id: sallaId, cr_number: cr },
      { id: otherMerchantId, owner_user_id: otherUserId, seller_name: "Other" }
    ]);
    // 1,200 events (> PostgREST's 1,000-row page) under the uuid key, plus Salla-keyed and foreign ones.
    await ins("events", Array.from({ length: 1200 }, (_, i) => ({ kind: "social.inbound", merchant: merchantId, payload: { from: "+966500000000", i } })));
    await ins("events", [{ kind: "salla.installed", merchant: sallaId, payload: {} }, { kind: "social.inbound", merchant: otherMerchantId, payload: {} }]);
    await ins("wathq_cache", { cr_number: cr, payload: { name: "PDPL IT" } });
    const emp = await sb.from("ai_employees").insert({ merchant_id: merchantId, role_id: "sales-rep", display_name: "Sara" }).select("id").single();
    if (emp.error) throw emp.error;
    await ins("ai_employee_integrations", { employee_id: emp.data.id, kind: "telegram", credentials: { bot_token: "SECRET-TOKEN" } });
    const conv = await sb.from("ai_employee_conversations").insert({ employee_id: emp.data.id, channel: "whatsapp", external_id: "+966511111111" }).select("id").single();
    if (conv.error) throw conv.error;
    await ins("ai_employee_messages", { conversation_id: conv.data.id, role: "user", content: "أريد الاستفسار عن طلبي" });
    await ins("bookings", { merchant_id: merchantId, name: "Customer", mobile: "+966522222222" });
  }, 60_000);

  afterAll(async () => {
    if (!sb) return;
    await sb.from("merchants").delete().in("id", [merchantId, otherMerchantId]);
    await sb.from("events").delete().in("merchant", [merchantId, sallaId, otherMerchantId]);
    await sb.from("wathq_cache").delete().eq("cr_number", cr);
    if (userId) await sb.auth.admin.deleteUser(userId);
    if (otherUserId) await sb.auth.admin.deleteUser(otherUserId);
  });

  it("exports every table, paginates past 1,000 rows, and never includes credentials", async () => {
    const m = await sb.from("merchants").select("*").eq("id", merchantId).single();
    const out = await buildMerchantExport(sb, m.data as never);
    expect((out.events as unknown[]).length).toBe(1201);
    expect((out.aiEmployeeMessages as unknown[]).length).toBe(1);
    expect((out.bookings as unknown[]).length).toBe(1);
    expect(out.truncated).toEqual([]);
    expect(JSON.stringify(out)).not.toContain("SECRET-TOKEN");
  });

  it("erases events (both keys), cached CR data and cascaded rows — but nothing of other merchants", async () => {
    const m = await sb.from("merchants").select("*").eq("id", merchantId).single();
    const report = await eraseMerchantData(sb, m.data as never);
    expect(report.eventsDeleted).toBe(1201);
    expect(report.wathqCacheDeleted).toBe(1);

    const left = await sb.from("events").select("id", { count: "exact", head: true }).in("merchant", [merchantId, sallaId]);
    expect(left.count).toBe(0);
    const msgs = await sb.from("ai_employee_messages").select("id", { count: "exact", head: true }).eq("content", "أريد الاستفسار عن طلبي");
    expect(msgs.count).toBe(0);
    const bookings = await sb.from("bookings").select("id", { count: "exact", head: true }).eq("merchant_id", merchantId);
    expect(bookings.count).toBe(0);
    const other = await sb.from("events").select("id", { count: "exact", head: true }).eq("merchant", otherMerchantId);
    expect(other.count).toBe(1);
  });
});
