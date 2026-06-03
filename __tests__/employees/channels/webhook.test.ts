import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "crypto";
import { sendWebhookMessage, assertPublicHttpUrl } from "@/lib/employees/channels/webhook";

afterEach(() => vi.unstubAllGlobals());

describe("sendWebhookMessage", () => {
  it("POSTs signed JSON with an HMAC-SHA256 header when a secret is set", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response("ok", { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendWebhookMessage(
      { url: "https://hooks.example.com/inbox", signing_secret: "s3cr3t" },
      "+15550001111",
      "hello",
      "subject line"
    );
    expect(res.status).toBe(200);
    expect(res.id).toMatch(/^whk_/);

    const init = fetchMock.mock.calls[0][1];
    const headers = init?.headers as Record<string, string>;
    const sentBody = init?.body as string;
    const expected = `sha256=${createHmac("sha256", "s3cr3t").update(sentBody).digest("hex")}`;
    expect(headers["x-arabclue-signature"]).toBe(expected);
    expect(JSON.parse(sentBody)).toMatchObject({
      type: "employee.message",
      to: "+15550001111",
      subject: "subject line",
      body: "hello"
    });
  });

  it("omits the signature header when no secret is configured", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response("", { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    await sendWebhookMessage({ url: "https://hooks.example.com/inbox" }, "+1", "hi");
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["x-arabclue-signature"]).toBeUndefined();
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<Response> => new Response("nope", { status: 500 }))
    );
    await expect(sendWebhookMessage({ url: "https://hooks.example.com/inbox" }, "+1", "x")).rejects.toThrow(
      /Webhook delivery failed: 500/
    );
  });
});

describe("assertPublicHttpUrl (SSRF guard)", () => {
  it("allows ordinary public http(s) URLs", () => {
    expect(() => assertPublicHttpUrl("https://api.example.com/hook")).not.toThrow();
    expect(() => assertPublicHttpUrl("http://example.org/x")).not.toThrow();
  });

  it.each([
    "http://localhost/x",
    "https://127.0.0.1/x",
    "http://169.254.169.254/latest/meta-data/", // cloud metadata
    "https://10.0.0.5/x",
    "http://172.16.4.4/x",
    "http://192.168.1.1/x",
    "https://service.local/x",
    "https://api.internal/x",
    "https://[::1]/x"
  ])("blocks private/loopback target %s", (u) => {
    expect(() => assertPublicHttpUrl(u)).toThrow();
  });

  it("rejects non-http(s) protocols and invalid URLs", () => {
    expect(() => assertPublicHttpUrl("ftp://example.com")).toThrow(/http/);
    expect(() => assertPublicHttpUrl("not a url")).toThrow(/valid URL/);
  });
});
