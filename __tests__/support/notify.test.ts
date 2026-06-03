import { describe, it, expect, vi, beforeEach } from "vitest";

const sendEmail = vi.hoisted(() =>
  vi.fn(
    async (_creds: { from: string; reply_to?: string }, _msg: { to: string; subject: string; text: string }) => ({
      id: "em_1"
    })
  )
);
vi.mock("@/lib/employees/channels/email", () => ({ sendEmail }));

import { sendSupportAck, buildSupportAckEmail } from "@/lib/support/notify";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SUPPORT_FROM_EMAIL;
  delete process.env.SUPPORT_REPLY_TO;
  delete process.env.EMAIL_FROM;
});

describe("buildSupportAckEmail", () => {
  it("is bilingual and reflects the category", () => {
    const { subject, text } = buildSupportAckEmail("billing");
    expect(subject).toContain("arabclue");
    expect(text).toContain("الفوترة"); // Arabic label
    expect(text).toContain("billing"); // English label
  });
  it("falls back to the help label for an unknown category", () => {
    // @ts-expect-error — exercising the runtime fallback for an out-of-enum value
    const { text } = buildSupportAckEmail("nonsense");
    expect(text).toContain("مساعدة");
  });
});

describe("sendSupportAck", () => {
  it("emails the requester with a default from address", async () => {
    const r = await sendSupportAck({ to: "buyer@store.sa", category: "help" });
    expect(r.id).toBe("em_1");
    const [creds, msg] = sendEmail.mock.calls[0];
    expect(creds.from).toBe("support@arabclue.com");
    expect(msg.to).toBe("buyer@store.sa");
  });

  it("honours SUPPORT_FROM_EMAIL and SUPPORT_REPLY_TO", async () => {
    process.env.SUPPORT_FROM_EMAIL = "help@myshop.sa";
    process.env.SUPPORT_REPLY_TO = "ops@myshop.sa";
    await sendSupportAck({ to: "x@y.com", category: "feature" });
    const [creds] = sendEmail.mock.calls[0];
    expect(creds.from).toBe("help@myshop.sa");
    expect(creds.reply_to).toBe("ops@myshop.sa");
  });

  it("propagates transport errors so the caller can degrade gracefully", async () => {
    sendEmail.mockRejectedValueOnce(new Error("Email send unavailable: set RESEND_API_KEY"));
    await expect(sendSupportAck({ to: "x@y.com", category: "bug" })).rejects.toThrow(/unavailable/);
  });
});
