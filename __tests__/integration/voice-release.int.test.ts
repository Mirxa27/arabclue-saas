/**
 * Integration test against a real Supabase stack (PostgREST + Postgres), SW-22 / SW-8:
 *   - deleting an account moves its Twilio SID into voice_number_releases (which has no merchant
 *     key) before anything is erased, so the record of the number survives the erasure;
 *   - a signed-in merchant cannot write voice_configs.enabled through the Data API.
 * Runs only when SUPABASE_IT_URL, SUPABASE_IT_SERVICE_KEY and SUPABASE_IT_ANON_KEY are set, e.g.
 *   SUPABASE_IT_URL=http://127.0.0.1:54321 SUPABASE_IT_SERVICE_KEY=... SUPABASE_IT_ANON_KEY=... \
 *   npx vitest run __tests__/integration/voice-release.int.test.ts
 * Twilio is never called: the release step is injected.
 */
import { randomBytes, randomUUID } from "crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eraseMerchantData } from "@/lib/merchant/pdpl";

const URL = process.env.SUPABASE_IT_URL;
const KEY = process.env.SUPABASE_IT_SERVICE_KEY;
const ANON = process.env.SUPABASE_IT_ANON_KEY;

describe.skipIf(!URL || !KEY || !ANON)("voice number release + enabled grant on a real stack (SW-22, SW-8)", () => {
  const sb: SupabaseClient = createClient(URL ?? "http://unused", KEY ?? "unused", { auth: { persistSession: false, autoRefreshToken: false } });
  const sid = `PNit${randomBytes(8).toString("hex")}`;
  const users: string[] = [];

  async function merchantWithNumber(plan: "lite" | "plus") {
    const email = `voice-it-${randomUUID()}@example.test`;
    const password = randomBytes(18).toString("base64url");
    const u = await sb.auth.admin.createUser({ email, password, email_confirm: true });
    if (u.error) throw u.error;
    users.push(u.data.user!.id);
    const merchantId = randomUUID();
    const m = await sb.from("merchants").insert({ id: merchantId, owner_user_id: u.data.user!.id, seller_name: "Voice IT", plan, subscription_status: "active" });
    if (m.error) throw m.error;
    return { merchantId, email, password };
  }

  afterAll(async () => {
    await sb.from("voice_number_releases").delete().eq("twilio_sid", sid);
    for (const id of users) await sb.auth.admin.deleteUser(id);
  });

  it("account deletion keeps the SID in the release queue after the merchant row is gone", async () => {
    const { merchantId } = await merchantWithNumber("plus");
    const v = await sb.from("voice_configs").insert({ merchant_id: merchantId, phone_number: `+9661199${Date.now() % 100000}`.slice(0, 13), twilio_incoming_sid: sid, enabled: true });
    expect(v.error).toBeNull();

    const release = vi.fn(async () => Promise.reject(new Error("Twilio unreachable in this test")));
    const report = await eraseMerchantData(sb, { id: merchantId }, {
      voiceNumbers: { release, twilio: () => ({ accountSid: "AC", authToken: "t", voiceWebhookUrl: "https://x/api/voice/twilio/inbound" }), now: () => new Date() }
    });

    expect(report.voiceNumber).toEqual({ queued: true, released: false });
    expect(release).toHaveBeenCalledWith(expect.anything(), sid);
    expect((await sb.from("merchants").select("id").eq("id", merchantId)).data).toEqual([]);
    expect((await sb.from("voice_configs").select("merchant_id").eq("merchant_id", merchantId)).data).toEqual([]);
    const { data: queued } = await sb.from("voice_number_releases").select("twilio_sid, status, reason, attempts, last_error").eq("twilio_sid", sid).single();
    expect(queued).toMatchObject({ twilio_sid: sid, status: "pending", reason: "account_deleted", attempts: 1 });
    expect(queued!.last_error).toContain("Twilio unreachable");
  });

  it("a signed-in lite merchant cannot switch voice on through the Data API", async () => {
    const { merchantId, email, password } = await merchantWithNumber("lite");
    await sb.from("voice_configs").insert({ merchant_id: merchantId, enabled: false });
    const user = createClient(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
    const signIn = await user.auth.signInWithPassword({ email, password });
    expect(signIn.error).toBeNull();

    const write = await user.from("voice_configs").update({ enabled: true }).eq("merchant_id", merchantId);
    expect(write.error?.code).toBe("42501");
    const settings = await user.from("voice_configs").update({ hours: "9-5" }).eq("merchant_id", merchantId).select("hours");
    expect(settings.error).toBeNull();
    expect(settings.data).toEqual([{ hours: "9-5" }]);
    expect((await sb.from("voice_configs").select("enabled").eq("merchant_id", merchantId).single()).data).toEqual({ enabled: false });

    await sb.from("merchants").delete().eq("id", merchantId);
  });
});
