import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { parseSlackEvent, verifySlackSignature } from "@/lib/employees/channels/slack";

describe("slack webhook helpers", () => {
  it("verifies signing secret", () => {
    const secret = "slack-signing-secret";
    const body = '{"type":"event_callback"}';
    const ts = String(Math.floor(Date.now() / 1000));
    const base = `v0:${ts}:${body}`;
    const sig = `v0=${createHmac("sha256", secret).update(base).digest("hex")}`;
    expect(verifySlackSignature(secret, sig, ts, body)).toBe(true);
    expect(verifySlackSignature(secret, sig, ts, "{}")).toBe(false);
  });

  it("parses url verification challenge", () => {
    const parsed = parseSlackEvent({ type: "url_verification", challenge: "abc" });
    expect(parsed?.channel).toBe("__challenge__");
    expect(parsed?.text).toBe("abc");
  });

  it("parses inbound messages", () => {
    const parsed = parseSlackEvent({
      type: "event_callback",
      event: { type: "message", channel: "C1", user: "U1", text: "hello" }
    });
    expect(parsed?.text).toBe("hello");
    expect(parsed?.channel).toBe("C1");
  });
});
