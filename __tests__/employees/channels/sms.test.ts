import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "crypto";
import { sendSms, verifyTwilioSignature, parseTwilioSmsWebhook } from "@/lib/employees/channels/sms";

const creds = { account_sid: "AC123", auth_token: "tok", from: "+15550001111" };

afterEach(() => vi.unstubAllGlobals());

describe("sendSms", () => {
  it("POSTs form-encoded to the Messages endpoint with basic auth", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response(JSON.stringify({ sid: "SM9" }), { status: 201 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendSms(creds, "+15550002222", "مرحبا");
    expect(res.sid).toBe("SM9");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from("AC123:tok").toString("base64")}`);
    const body = new URLSearchParams(init?.body as string);
    expect(body.get("To")).toBe("+15550002222");
    expect(body.get("From")).toBe("+15550001111");
    expect(body.get("Body")).toBe("مرحبا");
  });

  it("uses a Messaging Service SID when no from is given", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response(JSON.stringify({ sid: "SM10" }), { status: 201 })
    );
    vi.stubGlobal("fetch", fetchMock);
    await sendSms({ account_sid: "AC1", auth_token: "t", messaging_service_sid: "MG1" }, "+1", "x");
    const body = new URLSearchParams(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.get("MessagingServiceSid")).toBe("MG1");
    expect(body.get("From")).toBeNull();
  });

  it("surfaces Twilio API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<Response> => new Response(JSON.stringify({ error_message: "is not a valid phone number" }), { status: 400 }))
    );
    await expect(sendSms(creds, "+1", "x")).rejects.toThrow(/is not a valid phone number/);
  });

  it("validates required credentials before calling out", async () => {
    await expect(sendSms({ account_sid: "A", auth_token: "t" }, "+1", "x")).rejects.toThrow(
      /from.*messaging_service_sid/
    );
    await expect(sendSms({ account_sid: "", auth_token: "t", from: "+1" }, "+1", "x")).rejects.toThrow(/account_sid/);
  });
});

describe("verifyTwilioSignature", () => {
  const url = "https://arabclue.com/api/employees/webhooks/sms/emp1";
  const params = { From: "+15550002222", To: "+15550001111", Body: "hi there", MessageSid: "SM1" };

  function sign(token: string): string {
    const sortedKeys = Object.keys(params).sort();
    let data = url;
    for (const k of sortedKeys) data += k + (params as Record<string, string>)[k];
    return createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
  }

  it("accepts a correctly-signed request", () => {
    expect(verifyTwilioSignature("tok", url, params, sign("tok"))).toBe(true);
  });

  it("rejects forged, empty, or wrong-key signatures", () => {
    expect(verifyTwilioSignature("tok", url, params, sign("wrong-token"))).toBe(false);
    expect(verifyTwilioSignature("tok", url, params, "")).toBe(false);
    expect(verifyTwilioSignature("tok", url, params, null)).toBe(false);
    expect(verifyTwilioSignature("", url, params, sign("tok"))).toBe(false);
  });

  it("is sensitive to tampered params", () => {
    const good = sign("tok");
    expect(verifyTwilioSignature("tok", url, { ...params, Body: "tampered" }, good)).toBe(false);
  });
});

describe("parseTwilioSmsWebhook", () => {
  it("extracts from/to/body/id", () => {
    expect(parseTwilioSmsWebhook({ From: "+1", To: "+2", Body: "hello", MessageSid: "SM1" })).toEqual({
      from: "+1",
      to: "+2",
      messageId: "SM1",
      text: "hello"
    });
  });
  it("returns null when from or to is missing", () => {
    expect(parseTwilioSmsWebhook({ Body: "x" })).toBeNull();
    expect(parseTwilioSmsWebhook({ From: "+1", Body: "x" })).toBeNull();
  });
});
