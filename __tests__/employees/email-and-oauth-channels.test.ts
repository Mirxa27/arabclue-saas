/**
 * SW-6: employee email goes out under the merchant's own sender — their Resend key + verified
 * domain, or their Gmail account through the Gmail API (OAuth token, refreshed when expired) —
 * never the platform's RESEND_API_KEY / noreply sender.
 * SW-7: one-click OAuth results are mapped onto the keys each send adapter reads; connect → send
 * works for Slack, Gmail, WhatsApp and Instagram (real adapters, fetch faked).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../helpers/memory-db";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("../helpers/memory-db").createMemoryDb> }));
vi.mock("@/lib/db/supabase", () => ({ getServiceSupabase: () => h.db.client }));

import { checkResendSender, EmailNotConfiguredError, sendEmail } from "@/lib/employees/channels/email";
import { buildGmailMime } from "@/lib/employees/channels/gmail";
import { sendThroughIntegration } from "@/lib/employees/send";
import { decryptIntegrationCredentials } from "@/lib/employees/credentials";
import {
  completeOAuthChannelSetup,
  instagramSetup,
  OAuthChannelSetupError,
  slackSetup,
  whatsappSetup
} from "@/lib/employees/oauth/channel-setup";
import type { AIEmployeeIntegrationRow, IntegrationKind } from "@/lib/employees/types";

type Route = (url: string, init?: RequestInit) => Response | undefined;
let routes: Route[] = [];
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  for (const r of routes) {
    const res = r(url, init);
    if (res) return res;
  }
  throw new Error(`unexpected fetch ${url}`);
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const hits = (part: string) => fetchMock.mock.calls.filter(([u]) => String(u).includes(part));

const row = (kind: IntegrationKind, credentials: Record<string, unknown>, config: Record<string, unknown> = {}): AIEmployeeIntegrationRow => ({
  id: `i-${kind}`,
  employee_id: "e1",
  kind,
  external_id: null,
  credentials,
  config,
  status: "connected",
  last_event_at: null,
  created_at: new Date().toISOString()
});

beforeEach(() => {
  vi.clearAllMocks();
  routes = [];
  vi.stubGlobal("fetch", fetchMock);
  process.env.RESEND_API_KEY = "re_PLATFORM_KEY";
  process.env.GOOGLE_CLIENT_ID = "g-id";
  process.env.GOOGLE_CLIENT_SECRET = "g-secret";
  process.env.META_APP_ID = "900000000000001";
  process.env.META_APP_SECRET = "platform-meta-secret";
  process.env.TOKEN_ENCRYPTION_KEY = "test-encryption-key-0123456789abcdef";
  h.db = createMemoryDb({ ai_employee_integrations: [{ id: "i-gmail", kind: "gmail", credentials: {} }] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["RESEND_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "META_APP_ID", "META_APP_SECRET", "TOKEN_ENCRYPTION_KEY", "NEXT_PUBLIC_SITE_URL"]) {
    delete process.env[k];
  }
});

describe("SW-6: email channel (Resend) uses only the merchant's sender", () => {
  it("without the merchant's api_key it fails visibly — the platform RESEND_API_KEY is never used", async () => {
    await expect(sendEmail({ from: "layla@shop.sa" }, { to: "c@x.com", subject: "s", text: "t" })).rejects.toBeInstanceOf(EmailNotConfiguredError);
    await expect(sendEmail({}, { to: "c@x.com", subject: "s", text: "t" })).rejects.toBeInstanceOf(EmailNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses the platform's own domain as the sender", async () => {
    await expect(
      sendEmail({ from: "Arabclue Billing <billing@arabclue.com>", api_key: "re_merchant" }, { to: "c@x.com", subject: "s", text: "t" })
    ).rejects.toThrow(/own domain/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends with the merchant's key and sender", async () => {
    routes.push((u) => (u === "https://api.resend.com/emails" ? json({ id: "em_1" }) : undefined));
    await sendEmail({ from: "Layla <layla@shop.sa>", api_key: "re_merchant" }, { to: "c@x.com", subject: "s", text: "t" });
    const [, init] = hits("api.resend.com")[0];
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer re_merchant");
    expect(JSON.parse(String(init?.body))).toMatchObject({ from: "Layla <layla@shop.sa>", to: ["c@x.com"] });
  });

  it("connect check: verified domain ok; unverified refused; sending-only key accepted as unknown", async () => {
    const sender = { from: "layla@shop.sa", api_key: "re_merchant" };
    routes = [() => json({ data: [{ name: "shop.sa", status: "verified" }] })];
    expect(await checkResendSender(sender)).toEqual({ ok: true, domainVerified: true });
    routes = [() => json({ data: [{ name: "shop.sa", status: "pending" }] })];
    expect(await checkResendSender(sender)).toMatchObject({ ok: false, code: "email_domain_unverified" });
    routes = [() => json({ name: "restricted_api_key", message: "This API key is restricted to only send emails" }, 401)];
    expect(await checkResendSender(sender)).toEqual({ ok: true, domainVerified: "unknown" });
    routes = [() => json({ name: "invalid_api_key", message: "API key is invalid" }, 403)];
    expect(await checkResendSender(sender)).toMatchObject({ ok: false, code: "invalid_credentials" });
  });
});

describe("SW-6: Gmail channel sends through the Gmail API as the connected account", () => {
  const legacyOAuthRow = (config: Record<string, unknown> = {}) =>
    row("gmail", { access_token: "ya29.merchant", refresh_token: "1//refresh", token_type: "Bearer", external_label: "ops@store.sa" }, { connected_via: "oauth", ...config });

  it("uses the stored OAuth token (old rows too) and never touches Resend", async () => {
    routes.push((u) => (u.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages/send") ? json({ id: "gm-1" }) : undefined));
    const out = await sendThroughIntegration(legacyOAuthRow(), { to: "buyer@x.com", body: "مرحبا بك", subject: "طلبك جاهز" });
    expect(out).toEqual({ remoteId: "gm-1" });
    const [, init] = hits("gmail.googleapis.com")[0];
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer ya29.merchant");
    const mime = Buffer.from(JSON.parse(String(init?.body)).raw, "base64url").toString("utf8");
    expect(mime).toContain("From: ops@store.sa");
    expect(mime).toContain("To: buyer@x.com");
    expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from("طلبك جاهز").toString("base64")}?=`);
    expect(hits("api.resend.com")).toHaveLength(0);
  });

  it("refreshes an expired token with the refresh_token, saves it encrypted, then sends", async () => {
    routes.push((u, init) =>
      u === "https://oauth2.googleapis.com/token" && String(init?.body).includes("grant_type=refresh_token")
        ? json({ access_token: "ya29.fresh", expires_in: 3599 })
        : undefined
    );
    routes.push((u) => (u.includes("gmail.googleapis.com") ? json({ id: "gm-2" }) : undefined));
    await sendThroughIntegration(legacyOAuthRow({ token_expires_at: new Date(Date.now() - 60_000).toISOString() }), {
      to: "buyer@x.com",
      body: "hi"
    });
    expect((hits("gmail.googleapis.com")[0][1]?.headers as Record<string, string>).authorization).toBe("Bearer ya29.fresh");
    const saved = decryptIntegrationCredentials(h.db.table("ai_employee_integrations")[0].credentials as Record<string, unknown>);
    expect(saved.access_token).toBe("ya29.fresh");
  });

  it("refreshes once on a 401 and retries", async () => {
    let first = true;
    routes.push((u) => (u === "https://oauth2.googleapis.com/token" ? json({ access_token: "ya29.retry", expires_in: 3599 }) : undefined));
    routes.push((u) => {
      if (!u.includes("gmail.googleapis.com")) return undefined;
      if (first) {
        first = false;
        return json({ error: { message: "Invalid Credentials" } }, 401);
      }
      return json({ id: "gm-3" });
    });
    expect(await sendThroughIntegration(legacyOAuthRow(), { to: "buyer@x.com", body: "hi" })).toEqual({ remoteId: "gm-3" });
    expect(hits("gmail.googleapis.com")).toHaveLength(2);
  });

  it("header injection through the recipient is impossible", () => {
    expect(() => buildGmailMime("a@b.co", { to: "x@y.com\r\nBcc: victim@z.com", subject: "s", text: "t" })).toThrow(/recipient/);
  });
});

describe("SW-7: one-click OAuth → credentials the adapters can send with", () => {
  it("Slack: the oauth.v2.access bot token becomes bot_token; old rows with only access_token still send", async () => {
    routes.push((u) => (u === "https://slack.com/api/chat.postMessage" ? json({ ok: true, ts: "1.2" }) : undefined));
    const setup = slackSetup({ access_token: "xoxb-1-abc", token_type: "bot", raw: { team: { id: "T1", name: "Team" }, bot_user_id: "U1" } });
    expect(setup.credentials).toMatchObject({ bot_token: "xoxb-1-abc", team_id: "T1", bot_user_id: "U1" });
    await sendThroughIntegration(row("slack", setup.credentials), { to: "C0123ABCD", body: "hi" });
    await sendThroughIntegration(row("slack", { access_token: "xoxb-legacy-token", token_type: "bot" }, { connected_via: "oauth" }), { to: "C0123ABCD", body: "hi" });
    const auths = hits("slack.com").map(([, i]) => (i?.headers as Record<string, string>).authorization);
    expect(auths).toEqual(["Bearer xoxb-1-abc", "Bearer xoxb-legacy-token"]);
  });

  it("an old one-click row that can never send (WhatsApp without a number) is flagged error instead of staying 'connected'", async () => {
    h.db = createMemoryDb({
      ai_employee_integrations: [{ id: "i-wa-old", employee_id: "e1", kind: "whatsapp", status: "connected", config: { connected_via: "oauth" }, credentials: {} }]
    });
    const old = { ...row("whatsapp", { access_token: "EAAold", token_type: "bearer" }, { connected_via: "oauth" }), id: "i-wa-old" };
    await expect(sendThroughIntegration(old, { to: "966501112222", body: "hi" })).rejects.toThrow(/incomplete \(missing phone_number_id\)/);
    expect(fetchMock).not.toHaveBeenCalled();
    const stored = h.db.table("ai_employee_integrations")[0];
    expect(stored.status).toBe("error");
    expect((stored.config as { error: { reason: string } }).error.reason).toBe("credentials_incomplete");
  });

  it("Slack: a non-bot token is refused instead of saving a channel that cannot post", () => {
    expect(() => slackSetup({ access_token: "xoxp-user-token" })).toThrow(OAuthChannelSetupError);
  });

  function metaGraph(numbers: Array<{ id: string; display_phone_number: string }>) {
    routes.push((u) => (u.includes("/oauth/access_token") && u.includes("fb_exchange_token") ? json({ access_token: "EAALONG", expires_in: 5183944 }) : undefined));
    routes.push((u) =>
      u.includes("/debug_token")
        ? json({
            data: {
              app_id: "900000000000001",
              is_valid: true,
              granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["555000111"] }]
            }
          })
        : undefined
    );
    routes.push((u) => (u.includes("/555000111/phone_numbers") ? json({ data: numbers.map((n) => ({ ...n, verified_name: "Shop" })) }) : undefined));
    routes.push((u) => (u.includes("/messages") ? json({ messages: [{ id: "wamid.SENT" }] }) : undefined));
  }

  it("WhatsApp: long-lived token + WABA + its single number → phone_number_id; send goes to that number's endpoint", async () => {
    metaGraph([{ id: "106600000000001", display_phone_number: "+966 50 000 0999" }]);
    const setup = await whatsappSetup({ access_token: "EAASHORT" });
    expect(setup.status).toBe("connected");
    expect(setup.credentials).toMatchObject({ phone_number_id: "106600000000001", access_token: "EAALONG", waba_id: "555000111" });
    expect(String(setup.credentials.verify_token)).toMatch(/^[0-9a-f]{48}$/);
    await sendThroughIntegration(row("whatsapp", setup.credentials, { connected_via: "oauth" }), { to: "966501112222", body: "hi" });
    const [url, init] = hits("/messages").at(-1)!;
    expect(String(url)).toContain("/106600000000001/messages");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer EAALONG");
  });

  it("WhatsApp: several numbers → needs_setup with the options; the merchant's choice completes it", async () => {
    metaGraph([
      { id: "106600000000001", display_phone_number: "+966 50 000 0001" },
      { id: "106600000000002", display_phone_number: "+966 50 000 0002" }
    ]);
    const pending = await whatsappSetup({ access_token: "EAASHORT" });
    expect(pending).toMatchObject({ status: "needs_setup", setup: { state: "choose_phone_number" } });
    expect(pending.credentials).not.toHaveProperty("phone_number_id");
    const stored = { credentials: pending.credentials, config: { setup: pending.setup } };
    await expect(completeOAuthChannelSetup("whatsapp", stored, { phone_number_id: "999" })).rejects.toBeInstanceOf(OAuthChannelSetupError);
    const done = await completeOAuthChannelSetup("whatsapp", stored, { phone_number_id: "106600000000002" });
    expect(done.credentials).toMatchObject({ phone_number_id: "106600000000002", access_token: "EAALONG", waba_id: "555000111" });
  });

  it("Instagram: the Page with an IG account becomes page_id + page_access_token + ig_account_id (proven to be the platform app's)", async () => {
    routes.push((u) => (u.includes("fb_exchange_token") ? json({ access_token: "EAALONGUSER" }) : undefined));
    routes.push((u) =>
      u.includes("/me/accounts")
        ? json({ data: [{ id: "104000000000001", name: "متجر", access_token: "EAAPAGE-token-0123456789", instagram_business_account: { id: "17841400000000001" } }] })
        : undefined
    );
    routes.push((u) => (u.includes("/me?") ? json({ id: "104000000000001", name: "متجر", instagram_business_account: { id: "17841400000000001" } }) : undefined));
    routes.push((u) =>
      u.includes("/debug_token") ? json({ data: { app_id: "900000000000001", is_valid: true, profile_id: "104000000000001" } }) : undefined
    );
    routes.push((u, init) => (u.includes("/subscribed_apps") && init?.method === "POST" ? json({ success: true }) : undefined));
    routes.push((u) => (u.includes("/104000000000001/messages") ? json({ message_id: "mid.1", recipient_id: "IGSID1" }) : undefined));

    const setup = await instagramSetup({ access_token: "EAASHORT" });
    expect(setup.status).toBe("connected");
    expect(setup.credentials).toMatchObject({ page_id: "104000000000001", page_access_token: "EAAPAGE-token-0123456789", ig_account_id: "17841400000000001" });
    expect(setup.config).toMatchObject({ connected_via: "platform", subscribed: true });
    await sendThroughIntegration(row("instagram", setup.credentials, setup.config), { to: "1234567890", body: "hi" });
    expect(hits("/104000000000001/messages")).toHaveLength(1);
  });
});
