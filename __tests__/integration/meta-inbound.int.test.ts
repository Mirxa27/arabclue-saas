/**
 * Messenger / Instagram DM webhook (RB-W1, RB-W2) against a real Supabase stack (GoTrue +
 * PostgREST + Postgres with this repo's migrations). Runs only when these are set, e.g.
 *   SUPABASE_IT_URL=http://127.0.0.1:54321 SUPABASE_IT_ANON_KEY=… SUPABASE_IT_SERVICE_KEY=… \
 *     npx vitest run __tests__/integration/meta-inbound.int.test.ts
 *
 * Proves with real rows (encrypted credentials, as the connect route and the OAuth flow
 * store them), real claims and real RLS:
 *  - RB-W2: an Instagram OAuth publishing row does not take part in DM verification — an
 *    Instagram delivery signed by the Messenger app is acknowledged (kind_not_connected);
 *  - RB-W1: with META_APP_SECRET set (production), a bring-your-own-app row without its own
 *    secret is not verified with the platform secret (503) and a delivery whose signature
 *    matches no saved secret is refused (403);
 *  - both refusals land in ai_employee_actions and the merchant reads them back with the
 *    reason through GET /api/employees/:id on their own session — what the Activity tab shows.
 * Nothing external is called; after() work (the AI turn) is collected, not run.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextRequest } from "next/server";

const URL_ = process.env.SUPABASE_IT_URL;
const ANON = process.env.SUPABASE_IT_ANON_KEY;
const KEY = process.env.SUPABASE_IT_SERVICE_KEY;
const enabled = Boolean(URL_ && ANON && KEY);

const h = vi.hoisted(() => ({
  cookies: [] as Array<{ name: string; value: string }>,
  afterTasks: [] as unknown[]
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => h.cookies, set: () => undefined })
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: unknown) => {
    h.afterTasks.push(task); // the AI turn is not run here
  }
}));
vi.mock("@/lib/observability/error-reporter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/error-reporter")>()),
  reportError: vi.fn()
}));

import { POST as metaWebhook } from "@/app/api/employees/webhooks/meta/[id]/route";
import { GET as employeeDetail } from "@/app/api/employees/[id]/route";
import { encryptIntegrationCredentials } from "@/lib/employees/credentials";
import { inboundRejectionCopy } from "@/lib/employees/integration-errors";
import { signMetaPayload } from "@/lib/webhooks/meta-signature";

const PAGE = "104000000000001";
const IG = "17841400000000001";
const OWN_APP_SECRET = "merchant-own-app-secret-0123456789";
const PLATFORM_SECRET = "platform-app-secret-0123456789abc";

describe.skipIf(!enabled)("Meta DM webhook on a real Supabase stack (RB-W1, RB-W2)", () => {
  let admin: SupabaseClient;
  const run = randomUUID().slice(0, 8);
  const users: string[] = [];
  const merchants: string[] = [];
  const eventIds: string[] = [];

  async function sessionCookies(email: string, password: string) {
    const anon = createClient(URL_!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw error ?? new Error("no session");
    const captured = new Map<string, string>();
    const ssr = createServerClient(URL_!, ANON!, {
      cookies: {
        getAll: () => [...captured].map(([name, value]) => ({ name, value })),
        setAll: ((items) => {
          for (const c of items) {
            if (c.value) captured.set(c.name, c.value);
            else captured.delete(c.name);
          }
        }) satisfies SetAllCookies
      }
    });
    const set = await ssr.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
    if (set.error) throw set.error;
    return [...captured].map(([name, value]) => ({ name, value }));
  }

  /** A signed-in merchant with one employee and the given integration rows (stored like the app stores them). */
  async function hire(label: string, rows: Array<{ kind: string; credentials: Record<string, unknown>; config: Record<string, unknown>; external_id?: string | null }>) {
    const email = `it-meta-${label}-${run}@example.test`;
    const password = `pw-${randomUUID()}`;
    const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (user.error) throw user.error;
    users.push(user.data.user!.id);
    const merchantId = randomUUID();
    const m = await admin.from("merchants").insert({ id: merchantId, owner_user_id: user.data.user!.id, seller_name: `IT ${label}` });
    if (m.error) throw m.error;
    merchants.push(merchantId);
    const emp = await admin.from("ai_employees").insert({ merchant_id: merchantId, role_id: "sales-rep", display_name: "Sara" }).select("id").single();
    if (emp.error) throw emp.error;
    const employeeId = emp.data.id as string;
    for (const r of rows) {
      const ins = await admin.from("ai_employee_integrations").insert({
        employee_id: employeeId,
        kind: r.kind,
        external_id: r.external_id ?? null,
        credentials: encryptIntegrationCredentials(r.credentials),
        config: r.config,
        status: "connected"
      });
      if (ins.error) throw ins.error;
    }
    return { employeeId, cookies: await sessionCookies(email, password) };
  }

  function delivery(employeeId: string, payload: unknown, secret: string) {
    const raw = JSON.stringify(payload);
    return metaWebhook(
      new NextRequest(`http://localhost:3111/api/employees/webhooks/meta/${employeeId}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.77", "x-hub-signature-256": signMetaPayload(raw, secret) },
        body: raw
      }),
      { params: Promise.resolve({ id: employeeId }) }
    );
  }

  const dm = (mid: string, recipient: string) => ({
    sender: { id: "PSID-IT-1" },
    recipient: { id: recipient },
    timestamp: Date.now() - 5_000,
    message: { mid, text: "مرحبا، هل المنتج متوفر؟" }
  });
  const pageBody = (mid: string) => ({ object: "page", entry: [{ id: PAGE, time: Date.now(), messaging: [dm(mid, PAGE)] }] });
  const igBody = (mid: string) => ({ object: "instagram", entry: [{ id: IG, time: Date.now(), messaging: [dm(mid, IG)] }] });

  /** What the workspace Activity tab receives for this employee, read with the merchant's own session. */
  async function activityAsMerchant(employeeId: string, cookies: Array<{ name: string; value: string }>) {
    h.cookies = cookies;
    const res = await employeeDetail(new NextRequest(`http://localhost:3111/api/employees/${employeeId}`), {
      params: Promise.resolve({ id: employeeId })
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { actions: Array<{ action: string; channel: string | null; result: unknown }> }).actions;
  }

  beforeAll(async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_!);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON!);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", KEY!);
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "integration-token-encryption-key-32-chars");
    vi.stubEnv("META_APP_SECRET", PLATFORM_SECRET); // always set in production
    admin = createClient(URL_!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (!admin) return;
    if (eventIds.length) await admin.from("webhook_events").delete().eq("provider", "meta_messaging").in("event_id", eventIds);
    if (merchants.length) await admin.from("merchants").delete().in("id", merchants); // cascades to employees, rows, actions
    for (const id of users) await admin.auth.admin.deleteUser(id);
  });

  it("RB-W2 + RB-W1: the OAuth publishing row is ignored, Messenger works, a foreign signature is refused and shown to the merchant", async () => {
    const { employeeId, cookies } = await hire("a", [
      {
        kind: "meta",
        external_id: PAGE,
        credentials: { page_id: PAGE, page_access_token: "EAAPAGE-it-token", app_secret: OWN_APP_SECRET, verify_token: "it-verify-token-1234" },
        config: { connected_via: "manual", subscribed: true }
      },
      // Exactly what lib/employees/oauth/flow.ts stores for Instagram content publishing.
      { kind: "instagram", credentials: { access_token: "EAAuser-publishing-token", scope: "instagram_basic,instagram_content_publish" }, config: { connected_via: "oauth" } }
    ]);

    // RB-W2: an Instagram delivery signed by the merchant's app → acknowledged, nothing claimed.
    const igMid = `m_it_ig_${run}`;
    const ig = await delivery(employeeId, igBody(igMid), OWN_APP_SECRET);
    expect(ig.status).toBe(200);
    expect(await ig.json()).toEqual({ ok: true, ignored: "kind_not_connected" });
    const igClaim = await admin.from("webhook_events").select("id").eq("provider", "meta_messaging").eq("event_id", `instagram:${igMid}`);
    expect(igClaim.data).toEqual([]);

    // Messenger keeps working next to the publishing row: claimed for the AI turn.
    const pageMid = `m_it_pg_${run}`;
    eventIds.push(`meta:${pageMid}`);
    const page = await delivery(employeeId, pageBody(pageMid), OWN_APP_SECRET);
    expect(page.status).toBe(200);
    expect(await page.json()).toMatchObject({ ok: true, accepted: 1 });
    const claim = await admin.from("webhook_events").select("status").eq("provider", "meta_messaging").eq("event_id", `meta:${pageMid}`).single();
    expect(claim.data?.status).toBe("processing");

    // RB-W1: a signature that matches no saved secret (e.g. the merchant saved another app's secret) → 403, noted.
    const wrong = await delivery(employeeId, pageBody(`m_it_wrong_${run}`), "some-other-apps-secret-0123456789");
    expect(wrong.status).toBe(403);

    const actions = await activityAsMerchant(employeeId, cookies);
    const refused = actions.filter((a) => a.action === "inbound_rejected");
    expect(refused).toEqual([expect.objectContaining({ channel: "meta", result: { reason: "signature_mismatch" } })]);
    expect(inboundRejectionCopy(refused[0])?.en).toMatch(/signature does not match the saved App Secret/);
  });

  it("RB-W1: a bring-your-own-app row without app_secret is not verified with META_APP_SECRET (503), and the merchant sees why", async () => {
    const { employeeId, cookies } = await hire("b", [
      {
        kind: "meta",
        external_id: PAGE,
        credentials: { page_id: PAGE, page_access_token: "EAAPAGE-it-token-b", verify_token: "it-verify-token-5678" },
        config: { connected_via: "manual" }
      }
    ]);
    for (const secret of [OWN_APP_SECRET, PLATFORM_SECRET]) {
      const res = await delivery(employeeId, pageBody(`m_it_byo_${secret.length}_${run}`), secret);
      expect(res.status).toBe(503);
    }
    const claims = await admin.from("webhook_events").select("id").eq("provider", "meta_messaging").like("event_id", `meta:m_it_byo_%_${run}`);
    expect(claims.data).toEqual([]);

    const refused = (await activityAsMerchant(employeeId, cookies)).filter((a) => a.action === "inbound_rejected");
    expect(refused).toEqual([expect.objectContaining({ channel: "meta", result: { reason: "no_app_secret" } })]);
  });
});
