import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// Isolate the dispatcher's routing logic from each adapter's HTTP details.
vi.mock("@/lib/employees/channels/whatsapp", () => ({
  sendWhatsAppText: vi.fn(async () => ({ remoteId: "wa1" }))
}));
vi.mock("@/lib/employees/channels/telegram", () => ({
  sendTelegramText: vi.fn(async () => ({ remoteId: 42 }))
}));
vi.mock("@/lib/employees/channels/slack", () => ({
  sendSlackMessage: vi.fn(async () => ({ ts: "169.7" }))
}));
vi.mock("@/lib/employees/channels/email", () => ({
  sendEmail: vi.fn(async () => ({ id: "em1" }))
}));
vi.mock("@/lib/employees/channels/sms", () => ({
  sendSms: vi.fn(async () => ({ sid: "SM1" }))
}));
vi.mock("@/lib/employees/channels/webhook", () => ({
  sendWebhookMessage: vi.fn(async () => ({ id: "whk1", status: 200 }))
}));
vi.mock("@/lib/employees/channels/meta", () => ({
  sendMetaDirectMessage: vi.fn(async () => ({ messageId: "mid1", recipientId: "r1" }))
}));

import {
  dispatchChannelSend,
  isMessagingChannel,
  UnsupportedChannelError,
  MESSAGING_CHANNELS
} from "@/lib/employees/channels/dispatch";
import { sendSlackMessage } from "@/lib/employees/channels/slack";
import { sendEmail } from "@/lib/employees/channels/email";
import { sendMetaDirectMessage } from "@/lib/employees/channels/meta";

const base = { to: "+966500000000", body: "مرحبا" };

beforeEach(() => vi.clearAllMocks());

describe("dispatchChannelSend routing", () => {
  it("routes whatsapp", async () => {
    expect(await dispatchChannelSend({ kind: "whatsapp", credentials: {}, ...base })).toEqual({ remoteId: "wa1" });
  });

  it("stringifies the telegram message id", async () => {
    expect(await dispatchChannelSend({ kind: "telegram", credentials: {}, ...base })).toEqual({ remoteId: "42" });
  });

  it("routes slack and falls back to #general when no target", async () => {
    const r = await dispatchChannelSend({ kind: "slack", credentials: {}, to: "", body: "hi" });
    expect(r).toEqual({ remoteId: "169.7" });
    expect((sendSlackMessage as unknown as Mock).mock.calls[0][1]).toBe("#general");
  });

  it("routes email with a sensible default from", async () => {
    const r = await dispatchChannelSend({ kind: "email", credentials: {}, to: "a@b.com", body: "hi" });
    expect(r).toEqual({ remoteId: "em1" });
    expect((sendEmail as unknown as Mock).mock.calls[0][0].from).toBe("noreply@arabclue.com");
  });

  it("routes gmail through the email adapter and honours a configured from", async () => {
    const r = await dispatchChannelSend({ kind: "gmail", credentials: { from: "x@y.com" }, to: "a@b.com", body: "hi" });
    expect(r).toEqual({ remoteId: "em1" });
    expect((sendEmail as unknown as Mock).mock.calls[0][0].from).toBe("x@y.com");
  });

  it("routes twilio_sms", async () => {
    expect(await dispatchChannelSend({ kind: "twilio_sms", credentials: {}, ...base })).toEqual({ remoteId: "SM1" });
  });

  it("routes the generic webhook channel", async () => {
    expect(await dispatchChannelSend({ kind: "webhook", credentials: {}, ...base })).toEqual({ remoteId: "whk1" });
  });

  it("routes meta + instagram and passes the channel through", async () => {
    expect(await dispatchChannelSend({ kind: "meta", credentials: {}, to: "PSID", body: "hi" })).toEqual({ remoteId: "mid1" });
    expect(await dispatchChannelSend({ kind: "instagram", credentials: {}, to: "IGSID", body: "hi" })).toEqual({ remoteId: "mid1" });
    const calls = (sendMetaDirectMessage as unknown as Mock).mock.calls;
    expect(calls[0][0]).toBe("meta");
    expect(calls[1][0]).toBe("instagram");
  });
});

describe("non-messaging integrations are rejected (permanent contract, not a stub)", () => {
  it.each(["salla", "zatca", "github", "quickbooks", "x", "linkedin", "tiktok", "twilio_voice", "gcal"] as const)(
    "throws UnsupportedChannelError for %s",
    async (kind) => {
      await expect(dispatchChannelSend({ kind, credentials: {}, ...base })).rejects.toBeInstanceOf(
        UnsupportedChannelError
      );
    }
  );

  it("the error explains itself and lists supported channels", async () => {
    const err = await dispatchChannelSend({ kind: "salla", credentials: {}, ...base }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnsupportedChannelError);
    expect((err as Error).message).toContain("does not support direct text messages");
    expect((err as Error).message).toContain("whatsapp");
  });
});

describe("isMessagingChannel", () => {
  it("classifies every supported channel as messaging", () => {
    for (const k of MESSAGING_CHANNELS) expect(isMessagingChannel(k)).toBe(true);
  });
  it("classifies action/social/voice integrations as non-messaging", () => {
    for (const k of ["salla", "x", "twilio_voice", "github", "google_analytics"] as const) {
      expect(isMessagingChannel(k)).toBe(false);
    }
  });
});
