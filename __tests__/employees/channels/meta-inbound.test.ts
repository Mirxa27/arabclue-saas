import { createHmac } from "crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  META_DEFAULT_MAX_AGE_MS,
  metaAccountIdFor,
  metaAppSecretFor,
  metaKindForObject,
  metaVerifyTokenFor,
  metaWebhookEventId,
  parseMetaMessagingWebhook,
  resolveMetaVerifyChallenge,
  verifyMetaSignature
} from "@/lib/employees/channels/meta-inbound";

const SECRET = "merchant-app-secret-0123456789";
const sign = (raw: Buffer | string, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;

const PAGE = "104000000000001";
const IG = "17841400000000001";
const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);

afterEach(() => {
  delete process.env.META_APP_SECRET;
  delete process.env.META_WEBHOOK_VERIFY_TOKEN;
});

describe("verifyMetaSignature", () => {
  const raw = Buffer.from('{"object":"page","entry":[]}');

  it("accepts sha256=<hex> of the raw bytes", () => {
    expect(verifyMetaSignature(raw, sign(raw), SECRET)).toBe(true);
    expect(verifyMetaSignature(raw, sign(raw).toUpperCase().replace("SHA256=", "sha256="), SECRET)).toBe(true);
  });

  it("rejects a wrong secret, a changed byte, and malformed headers", () => {
    const changed = Buffer.from(raw);
    changed[2] ^= 1;
    const hex = sign(raw).slice("sha256=".length);
    expect(verifyMetaSignature(raw, sign(raw, "other-secret-xxxxxxxx"), SECRET)).toBe(false);
    expect(verifyMetaSignature(changed, sign(raw), SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, null, SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, hex, SECRET)).toBe(false); // no sha256= prefix
    expect(verifyMetaSignature(raw, `sha1=${hex.slice(0, 40)}`, SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, `sha256=${"z".repeat(64)}`, SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, `sha256=${hex.slice(0, 63)}`, SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, `sha256=${hex}0`, SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, sign(raw, ""), "")).toBe(false);
  });

  it("hashes the escaped-unicode bytes Meta sends, not re-serialised Arabic", () => {
    // How Meta delivers Arabic text: \u escapes in an ASCII body.
    const raw = Buffer.from('{"object":"page","entry":[{"messaging":[{"message":{"text":"\\u0645\\u0631\\u062d\\u0628\\u0627"}}]}]}');
    expect(raw.toString("utf8")).toContain("\\u0645");
    const reserialised = JSON.stringify(JSON.parse(raw.toString("utf8")));
    expect(reserialised).toContain("مرحبا");
    expect(verifyMetaSignature(raw, sign(raw), SECRET)).toBe(true);
    expect(verifyMetaSignature(raw, sign(reserialised), SECRET)).toBe(false);
  });
});

describe("resolveMetaVerifyChallenge", () => {
  const params = (mode: string, token: string, challenge: string) =>
    new URLSearchParams({ "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge });

  it("echoes the challenge for subscribe + a matching token", () => {
    expect(resolveMetaVerifyChallenge(params("subscribe", "verify-token-123456", "1158201444"), ["verify-token-123456"])).toBe(
      "1158201444"
    );
    expect(resolveMetaVerifyChallenge(params("subscribe", "b-token-1234567890", "42"), [null, "a-token", "b-token-1234567890"])).toBe("42");
  });

  it("refuses a wrong token, another mode, an empty challenge or no expected tokens", () => {
    expect(resolveMetaVerifyChallenge(params("subscribe", "wrong", "1"), ["verify-token-123456"])).toBeNull();
    expect(resolveMetaVerifyChallenge(params("unsubscribe", "verify-token-123456", "1"), ["verify-token-123456"])).toBeNull();
    expect(resolveMetaVerifyChallenge(params("subscribe", "verify-token-123456", ""), ["verify-token-123456"])).toBeNull();
    expect(resolveMetaVerifyChallenge(params("subscribe", "verify-token-123456", "1"), [])).toBeNull();
    expect(resolveMetaVerifyChallenge(params("subscribe", "verify-token-123456", "1"), [null, undefined, ""])).toBeNull();
  });

  it("does not throw on tokens of a different length and never echoes markup", () => {
    expect(() => resolveMetaVerifyChallenge(params("subscribe", "x", "1"), ["a-much-longer-token-value"])).not.toThrow();
    expect(resolveMetaVerifyChallenge(params("subscribe", "t-0123456789abcdef", "<script>"), ["t-0123456789abcdef"])).toBeNull();
  });
});

describe("secret / token / account resolution", () => {
  it("prefers the integration's values and falls back to the env only when absent", () => {
    process.env.META_APP_SECRET = "env-app-secret";
    process.env.META_WEBHOOK_VERIFY_TOKEN = "env-verify-token";
    expect(metaAppSecretFor({ app_secret: "own" })).toBe("own");
    expect(metaAppSecretFor({ app_secret: "  " })).toBe("env-app-secret");
    expect(metaAppSecretFor({})).toBe("env-app-secret");
    expect(metaVerifyTokenFor({ verify_token: "own-token" })).toBe("own-token");
    expect(metaVerifyTokenFor({})).toBe("env-verify-token");
  });

  it("returns null when neither is configured (the route then refuses the delivery)", () => {
    expect(metaAppSecretFor({})).toBeNull();
    expect(metaVerifyTokenFor(undefined)).toBeNull();
  });

  it("maps objects to kinds and kinds to account ids", () => {
    expect(metaKindForObject("page")).toBe("meta");
    expect(metaKindForObject("instagram")).toBe("instagram");
    expect(metaKindForObject("whatsapp_business_account")).toBeNull();
    expect(metaKindForObject(undefined)).toBeNull();
    expect(metaAccountIdFor("meta", { page_id: PAGE, ig_account_id: IG })).toBe(PAGE);
    expect(metaAccountIdFor("instagram", { page_id: PAGE, ig_account_id: IG })).toBe(IG);
    expect(metaAccountIdFor("instagram", { page_id: PAGE })).toBeNull();
    expect(metaWebhookEventId("instagram", "m_1")).toBe("instagram:m_1");
  });
});

type Messaging = Record<string, unknown>;
const dm = (overrides: Partial<{ sender: string; recipient: string; mid: string; text: string; timestamp: number }> = {}, message: Record<string, unknown> = {}): Messaging => ({
  sender: { id: overrides.sender ?? "PSID-1" },
  recipient: { id: overrides.recipient ?? PAGE },
  timestamp: overrides.timestamp ?? NOW - 1000,
  message: { mid: overrides.mid ?? "m_1", text: overrides.text ?? "مرحبا", ...message }
});
const pagePayload = (messaging: Messaging[], entryId = PAGE, extra: Record<string, unknown> = {}) => ({
  object: "page",
  entry: [{ id: entryId, time: NOW, messaging, ...extra }]
});
const parsePage = (payload: unknown) => parseMetaMessagingWebhook(payload, { kind: "meta", accountId: PAGE, nowMs: NOW });

describe("parseMetaMessagingWebhook — Messenger (object page)", () => {
  it("accepts a text DM with the PSID as the reply target", () => {
    const { accepted, skipped } = parsePage(pagePayload([dm()]));
    expect(skipped).toEqual({});
    expect(accepted).toEqual([
      { kind: "meta", accountId: PAGE, senderId: "PSID-1", mid: "m_1", text: "مرحبا", timestamp: NOW - 1000, hasAttachments: false }
    ]);
  });

  it("accepts every item of a batch and sorts by timestamp", () => {
    const payload = {
      object: "page",
      entry: [
        { id: PAGE, messaging: [dm({ mid: "m_c", timestamp: NOW - 100 }), dm({ mid: "m_a", timestamp: NOW - 300 })] },
        { id: PAGE, messaging: [dm({ mid: "m_d", timestamp: NOW - 50 }), dm({ mid: "m_b", timestamp: NOW - 200 })] }
      ]
    };
    expect(parsePage(payload).accepted.map((m) => m.mid)).toEqual(["m_a", "m_b", "m_c", "m_d"]);
  });

  it("drops another Page's entry, a recipient mismatch, its own messages and echoes", () => {
    expect(parsePage(pagePayload([dm()], "999")).skipped).toEqual({ foreign_account: 1 });
    expect(parsePage(pagePayload([dm({ recipient: "999" })])).skipped).toEqual({ recipient_mismatch: 1 });
    expect(parsePage(pagePayload([dm({ sender: PAGE })])).skipped).toEqual({ self: 1 });
    expect(parsePage(pagePayload([dm({}, { is_echo: true, app_id: 263902037430900 })])).skipped).toEqual({ echo: 1 });
  });

  it("drops delivery / read receipts, reactions and postbacks (no message object)", () => {
    const base = { sender: { id: "PSID-1" }, recipient: { id: PAGE }, timestamp: NOW };
    const { accepted, skipped } = parsePage(
      pagePayload([
        { ...base, delivery: { mids: ["m_1"], watermark: NOW } },
        { ...base, read: { watermark: NOW } },
        { ...base, reaction: { mid: "m_1", action: "react", emoji: "❤" } },
        { ...base, postback: { title: "Start", payload: "START" } }
      ])
    );
    expect(accepted).toEqual([]);
    expect(skipped).toEqual({ non_message: 4 });
  });

  it("drops attachment-only messages but keeps text that comes with attachments", () => {
    const attachments = [{ type: "image", payload: { url: "https://example.test/x.jpg" } }];
    expect(parsePage(pagePayload([dm({ text: "" }, { text: undefined, attachments })])).skipped).toEqual({ attachment_only: 1 });
    const withText = parsePage(pagePayload([dm({ text: "كم السعر؟" }, { attachments })]));
    expect(withText.accepted[0]).toMatchObject({ text: "كم السعر؟", hasAttachments: true });
  });

  it("drops a missing mid, an empty text and a 25-hour-old message", () => {
    expect(parsePage(pagePayload([dm({ mid: "" })])).skipped).toEqual({ no_mid: 1 });
    expect(parsePage(pagePayload([dm({ text: "   " })])).skipped).toEqual({ empty: 1 });
    expect(parsePage(pagePayload([dm({ timestamp: NOW - 25 * 3600 * 1000 })])).skipped).toEqual({ stale: 1 });
    expect(parsePage(pagePayload([dm({ timestamp: NOW - META_DEFAULT_MAX_AGE_MS + 60_000 })])).accepted).toHaveLength(1);
  });

  it("never reads entry.standby or entry.changes", () => {
    const payload = pagePayload([], PAGE, {
      standby: [dm({ mid: "m_standby" })],
      changes: [{ field: "feed", value: { item: "comment", message: "hi" } }]
    });
    expect(parsePage(payload)).toEqual({ accepted: [], skipped: {} });
  });

  it("keeps 17-digit ids exact (never through Number)", () => {
    const big = "17841400000000123";
    const out = parseMetaMessagingWebhook(
      { object: "instagram", entry: [{ id: big, messaging: [dm({ recipient: big, sender: "17841499999999999" })] }] },
      { kind: "instagram", accountId: big, nowMs: NOW }
    );
    expect(out.accepted[0]).toMatchObject({ accountId: big, senderId: "17841499999999999" });
  });

  it("caps very long text before it reaches the model", () => {
    const out = parseMetaMessagingWebhook(pagePayload([dm({ text: "ب".repeat(5000) })]), {
      kind: "meta",
      accountId: PAGE,
      nowMs: NOW,
      maxTextChars: 4000
    });
    expect(Array.from(out.accepted[0].text)).toHaveLength(4000);
  });

  it("tolerates garbage", () => {
    expect(parsePage(null)).toEqual({ accepted: [], skipped: {} });
    expect(parsePage({ entry: "x" })).toEqual({ accepted: [], skipped: {} });
    expect(parsePage({ entry: [1, { id: PAGE, messaging: [null, "x"] }] }).skipped).toEqual({ malformed: 3 });
  });
});

describe("parseMetaMessagingWebhook — Instagram (object instagram)", () => {
  const igPayload = (messaging: Messaging[]) => ({ object: "instagram", entry: [{ id: IG, time: NOW, messaging }] });
  const parseIg = (payload: unknown) => parseMetaMessagingWebhook(payload, { kind: "instagram", accountId: IG, nowMs: NOW });

  it("accepts a DM with the IGSID", () => {
    const out = parseIg(igPayload([dm({ sender: "IGSID-7", recipient: IG, mid: "aWdfZAG1" })]));
    expect(out.accepted).toEqual([
      { kind: "instagram", accountId: IG, senderId: "IGSID-7", mid: "aWdfZAG1", text: "مرحبا", timestamp: NOW - 1000, hasAttachments: false }
    ]);
  });

  it("rejects echoes (Instagram sends them under the messages field)", () => {
    expect(parseIg(igPayload([dm({ sender: IG, recipient: "IGSID-7" }, { is_echo: true })])).skipped).toEqual({ echo: 1 });
  });

  it("rejects deleted and unsupported messages", () => {
    expect(parseIg(igPayload([dm({ recipient: IG }, { is_deleted: true })])).skipped).toEqual({ deleted: 1 });
    expect(parseIg(igPayload([dm({ recipient: IG }, { is_unsupported: true })])).skipped).toEqual({ unsupported: 1 });
  });

  it("accepts story replies and quick-reply taps (they carry text)", () => {
    const out = parseIg(
      igPayload([
        dm({ recipient: IG, mid: "m_story", text: "عجبني" }, { reply_to: { story: { url: "https://x.test/s", id: "s1" } } }),
        dm({ recipient: IG, mid: "m_quick", text: "نعم" }, { quick_reply: { payload: "YES" }, reply_to: { mid: "m_prev" } })
      ])
    );
    expect(out.accepted.map((m) => m.mid)).toEqual(["m_story", "m_quick"]);
    expect(out.accepted[1].replyToMid).toBe("m_prev");
  });
});
