/**
 * Data fixes against a real Supabase stack (GoTrue + PostgREST + Postgres with this repo's
 * migrations, through 20261106007300). Runs only when these are set, e.g.
 *   SUPABASE_IT_URL=http://127.0.0.1:54321 SUPABASE_IT_ANON_KEY=… SUPABASE_IT_SERVICE_KEY=… \
 *     npx vitest run __tests__/integration/data-fixes.int.test.ts
 *
 *  - RA-3 / RA-9: a signed-in owner's Data API session cannot read the Salla tokens or the ZATCA
 *    CSID (select=*, select=access_token → 42501), reads its own row through the client column
 *    list, and can still PATCH profile columns (POST /api/merchant/tax, /dpa).
 *  - RB-S2: the lifecycle RPCs resolve through PostgREST with named arguments, and a retried
 *    uninstall older than a reinstall is stale.
 *  - RB-S1 / RA-14: after Disconnect, PDPL export/erasure still find the store's events through
 *    the link history; the export carries support tickets, feedback and agent settings.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MERCHANT_CLIENT_COLUMNS, MERCHANT_SECRET_COLUMNS } from "@/lib/merchant/columns";
import { markSallaStoreUninstalled, recordSallaAuthorization, unlinkSallaStore } from "@/lib/salla/connect";
import { buildMerchantExport, eraseMerchantData } from "@/lib/merchant/pdpl";

const URL_ = process.env.SUPABASE_IT_URL;
const ANON = process.env.SUPABASE_IT_ANON_KEY;
const KEY = process.env.SUPABASE_IT_SERVICE_KEY;
const enabled = Boolean(URL_ && ANON && KEY);

describe.skipIf(!enabled)("data fixes on a real Supabase stack", () => {
  let admin: SupabaseClient;
  const run = randomUUID().slice(0, 8);
  const store = `it-df-store-${run}`;
  const users: Array<{ id: string; email: string; password: string; merchantId: string }> = [];

  async function signedIn(email: string, password: string): Promise<SupabaseClient> {
    const client = createClient(URL_!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return client;
  }

  beforeAll(async () => {
    admin = createClient(URL_!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const label of ["a", "b"]) {
      const email = `it-df-${label}-${run}@example.test`;
      const password = `pw-${randomUUID()}`;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error) throw created.error;
      users.push({ id: created.data.user!.id, email, password, merchantId: randomUUID() });
    }
    const [a, b] = users;
    const ins = await admin.from("merchants").insert([
      {
        id: a.merchantId,
        owner_user_id: a.id,
        seller_name: `IT DF A ${run}`,
        salla_merchant_id: store,
        access_token: "enc:v1:IT-SALLA-ACCESS",
        refresh_token: "enc:v1:IT-SALLA-REFRESH",
        salla_state: "it-state",
        zatca_csid: "IT-ZATCA-CSID",
        installed_at: new Date(Date.now() - 3_600_000).toISOString()
      },
      { id: b.merchantId, owner_user_id: b.id, seller_name: `IT DF B ${run}` }
    ]);
    if (ins.error) throw ins.error;
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("events").delete().in("merchant", [store, ...users.map((u) => u.merchantId)]);
    await admin.from("merchants").delete().in("id", users.map((u) => u.merchantId));
    await admin.from("salla_store_lifecycle").delete().eq("salla_merchant_id", store);
    await admin.from("salla_store_links").delete().eq("salla_merchant_id", store);
    for (const u of users) await admin.auth.admin.deleteUser(u.id);
  });

  it("RA-3/RA-9: the owner's session cannot read credentials, only the client columns", async () => {
    const [a, b] = users;
    const sb = await signedIn(a.email, a.password);

    const all = await sb.from("merchants").select("*").eq("owner_user_id", a.id).maybeSingle();
    expect(all.error?.code).toBe("42501");
    for (const secret of MERCHANT_SECRET_COLUMNS) {
      const res = await sb.from("merchants").select(`id, ${secret}`).eq("id", a.merchantId);
      expect(res.error?.code, secret).toBe("42501");
    }

    const own = await sb.from("merchants").select(MERCHANT_CLIENT_COLUMNS).eq("owner_user_id", a.id).maybeSingle();
    expect(own.error).toBeNull();
    expect(own.data).toMatchObject({ id: a.merchantId, salla_merchant_id: store });
    expect(JSON.stringify(own.data)).not.toMatch(/IT-SALLA|IT-ZATCA|it-state/);
    const other = await sb.from("merchants").select("id").eq("id", b.merchantId);
    expect(other.data).toEqual([]);

    // profile edits as /api/merchant/tax and /dpa send them (no RETURNING)
    const upd = await sb.from("merchants").update({ seller_name: `IT DF A renamed ${run}`, vat_number: "300000000000003" }).eq("id", a.merchantId);
    expect(upd.error).toBeNull();
    const after = await admin.from("merchants").select("seller_name, access_token").eq("id", a.merchantId).single();
    expect(after.data).toMatchObject({ seller_name: `IT DF A renamed ${run}`, access_token: "enc:v1:IT-SALLA-ACCESS" });
  });

  it("RB-S2: a retried uninstall older than a reinstall is stale (PostgREST RPC, named args)", async () => {
    const [a] = users;
    const t = Date.now();
    const iso = (offsetMin: number) => new Date(t + offsetMin * 60_000).toISOString();
    const tokens = (n: string) => ({ accessToken: `enc:v1:it-at-${n}`, refreshToken: `enc:v1:it-rt-${n}`, expiresAt: iso(14 * 24 * 60) });

    expect(await markSallaStoreUninstalled(admin, store, iso(-10))).toBe("uninstalled");
    expect(await recordSallaAuthorization(admin, { storeId: store, tokens: tokens("2"), scope: null, identity: null, eventAt: iso(-8) })).toEqual({
      outcome: "linked_updated",
      merchantId: a.merchantId
    });
    expect(await markSallaStoreUninstalled(admin, store, iso(-10))).toBe("stale");
    const row = await admin.from("merchants").select("access_token, uninstalled_at").eq("id", a.merchantId).single();
    expect(row.data).toEqual({ access_token: "enc:v1:it-at-2", uninstalled_at: null });

    expect(await markSallaStoreUninstalled(admin, store, iso(-5))).toBe("uninstalled");
    expect(await recordSallaAuthorization(admin, { storeId: store, tokens: tokens("2"), scope: null, identity: null, eventAt: iso(-8) })).toEqual({
      outcome: "stale"
    });
    const cleared = await admin.from("merchants").select("access_token").eq("id", a.merchantId).single();
    expect(cleared.data?.access_token).toBeNull();
  });

  it("RB-S1 + RA-14: Disconnect, then export and erase still cover the store's events", async () => {
    const [a] = users;
    const ev = await admin.from("events").insert([
      { kind: "order.updated", merchant: store, payload: { data: { customer: { email: "buyer@example.test" } } } },
      { kind: "voice.inbound_call", merchant: a.merchantId, payload: {} }
    ]);
    expect(ev.error).toBeNull();
    const t = await admin.from("support_tickets").insert({ user_id: a.id, merchant_id: a.merchantId, category: "help", message: "IT ticket message" });
    expect(t.error).toBeNull();
    const f = await admin.from("user_feedback").insert({ user_id: a.id, sentiment: "up", note: "IT feedback" });
    expect(f.error).toBeNull();
    const s = await admin.from("agent_settings").insert({ merchant_id: a.merchantId, persona_role: "seo", enabled: false, status: "idle" });
    expect(s.error).toBeNull();

    expect(await unlinkSallaStore(admin, a.merchantId)).toBe(true);
    const sb = await signedIn(a.email, a.password);
    const merchant = (await sb.from("merchants").select(MERCHANT_CLIENT_COLUMNS).eq("id", a.merchantId).single()).data as unknown as {
      id: string;
      salla_merchant_id: string | null;
    } & Record<string, unknown>;
    expect(merchant.salla_merchant_id).toBeNull();

    const out = await buildMerchantExport(admin, merchant);
    expect((out.events as Array<{ kind: string }>).map((e) => e.kind).sort()).toEqual(
      expect.arrayContaining(["order.updated", "voice.inbound_call"])
    );
    expect(out.supportTickets).toEqual([expect.objectContaining({ message: "IT ticket message" })]);
    expect(out.userFeedback).toEqual([expect.objectContaining({ note: "IT feedback" })]);
    expect(out.agentSettings).toEqual([expect.objectContaining({ persona_role: "seo" })]);
    expect(out.sallaStoreLinks).toEqual([expect.objectContaining({ salla_merchant_id: store, unlinked_at: expect.any(String) })]);
    expect(JSON.stringify(out)).not.toMatch(/IT-SALLA|IT-ZATCA/);

    const report = await eraseMerchantData(admin, merchant);
    expect(report.eventsDeleted).toBeGreaterThanOrEqual(2);
    const left = await admin.from("events").select("id", { count: "exact", head: true }).eq("merchant", store);
    expect(left.count).toBe(0);
  }, 60_000);
});
