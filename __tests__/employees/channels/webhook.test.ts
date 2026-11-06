/**
 * Generic webhook channel (SW-4): delivery goes through the outbound guard — DNS-resolved
 * addresses must be public, the connection is pinned to the checked address, redirects are
 * not followed, and the receiver's response body never appears in an error.
 * node:http / node:https are replaced by a recording fake (the guard refuses loopback, so a
 * real local receiver cannot be used — by design).
 */
import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

type RecordedRequest = { options: Record<string, unknown>; body: string };
const h = vi.hoisted(() => ({
  calls: [] as RecordedRequest[],
  respond: { status: 200, body: "ok" } as { status: number; body: string; error?: string }
}));

async function fakeTransport() {
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  return {
    default: {
      request(options: Record<string, unknown>, onResponse: (res: unknown) => void) {
        const req = new EventEmitter() as InstanceType<typeof EventEmitter> & { end: (chunk?: Buffer) => void };
        req.end = (chunk?: Buffer) => {
          h.calls.push({ options, body: chunk ? chunk.toString("utf8") : "" });
          if (h.respond.error) {
            queueMicrotask(() => req.emit("error", Object.assign(new Error("boom"), { code: h.respond.error })));
            return;
          }
          const res = Object.assign(new PassThrough(), { statusCode: h.respond.status });
          onResponse(res);
          res.end(h.respond.body);
        };
        return req;
      }
    }
  };
}
vi.mock("node:https", fakeTransport);
vi.mock("node:http", fakeTransport);

import { assertPublicHttpUrl, sendWebhookMessage, verifyWebhookUrl } from "@/lib/employees/channels/webhook";

const PUBLIC = async () => [{ address: "93.184.216.34", family: 4 as const }];

beforeEach(() => {
  h.calls.length = 0;
  h.respond = { status: 200, body: "ok" };
});

describe("sendWebhookMessage", () => {
  it("POSTs signed JSON with an HMAC-SHA256 header, pinned to the address that was checked", async () => {
    const res = await sendWebhookMessage(
      { url: "https://hooks.example.com/inbox?x=1", signing_secret: "s3cr3t-s3cr3t-s3cr3t" },
      "+15550001111",
      "hello",
      "subject line",
      { lookup: PUBLIC }
    );
    expect(res.status).toBe(200);
    expect(res.id).toMatch(/^whk_/);

    const [{ options, body }] = h.calls;
    expect(options).toMatchObject({ hostname: "hooks.example.com", path: "/inbox?x=1", method: "POST", agent: false, servername: "hooks.example.com" });
    const headers = options.headers as Record<string, string>;
    expect(headers["x-arabclue-signature"]).toBe(`sha256=${createHmac("sha256", "s3cr3t-s3cr3t-s3cr3t").update(body).digest("hex")}`);
    expect(JSON.parse(body)).toMatchObject({ type: "employee.message", to: "+15550001111", subject: "subject line", body: "hello" });

    // The socket's DNS lookup is answered with the checked address, never a fresh resolution.
    const lookup = options.lookup as (h: string, o: unknown, cb: (...a: unknown[]) => void) => void;
    const one = vi.fn();
    lookup("hooks.example.com", {}, one);
    expect(one).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    const all = vi.fn();
    lookup("hooks.example.com", { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
  });

  it("omits the signature header when no secret is configured, and drops framing headers a tenant set", async () => {
    await sendWebhookMessage(
      { url: "https://hooks.example.com/inbox", headers: { host: "169.254.169.254", "Content-Length": "1", "x-api-key": "k" } },
      "+1",
      "hi",
      undefined,
      { lookup: PUBLIC }
    );
    const headers = h.calls[0].options.headers as Record<string, string>;
    expect(headers["x-arabclue-signature"]).toBeUndefined();
    expect(headers.host).toBeUndefined();
    expect(headers["x-api-key"]).toBe("k");
    expect(headers["content-length"]).toBe(String(Buffer.byteLength(h.calls[0].body)));
  });

  it("a non-2xx answer fails with the status only — the receiver's body never leaks into the error", async () => {
    h.respond = { status: 500, body: "INTERNAL-ONLY-SECRET: aws_secret_access_key=abc" };
    const err = await sendWebhookMessage({ url: "https://hooks.example.com/inbox" }, "+1", "x", undefined, { lookup: PUBLIC }).catch((e: Error) => e);
    expect((err as Error).message).toBe("Webhook delivery failed: HTTP 500");
    expect((err as Error).message).not.toContain("INTERNAL");
  });

  it("does not follow a redirect (one request, delivery failed)", async () => {
    h.respond = { status: 307, body: "" };
    await expect(
      sendWebhookMessage({ url: "https://hooks.example.com/inbox" }, "+1", "x", undefined, { lookup: PUBLIC })
    ).rejects.toThrow(/HTTP 307 \(redirects are not followed\)/);
    expect(h.calls).toHaveLength(1);
  });

  it.each([
    ["loopback", [{ address: "127.0.0.1", family: 4 as const }]],
    ["cloud metadata", [{ address: "169.254.169.254", family: 4 as const }]],
    ["IPv4-mapped loopback", [{ address: "::ffff:127.0.0.1", family: 6 as const }]],
    ["one private record among public ones", [{ address: "93.184.216.34", family: 4 as const }, { address: "10.0.0.7", family: 4 as const }]]
  ])("refuses a host name that resolves to %s — before any request", async (_label, records) => {
    await expect(
      sendWebhookMessage({ url: "https://rebind.example.com/x" }, "+1", "x", undefined, { lookup: async () => records })
    ).rejects.toThrow(/refused/);
    expect(h.calls).toHaveLength(0);
  });

  it("reports a network failure without provider text", async () => {
    h.respond = { status: 0, body: "", error: "ECONNREFUSED" };
    await expect(
      sendWebhookMessage({ url: "https://hooks.example.com/inbox" }, "+1", "x", undefined, { lookup: PUBLIC })
    ).rejects.toThrow("Webhook delivery failed: request failed: ECONNREFUSED");
  });
});

describe("assertPublicHttpUrl / verifyWebhookUrl (SSRF guard)", () => {
  it("allows ordinary public http(s) URLs", async () => {
    expect(() => assertPublicHttpUrl("https://api.example.com/hook")).not.toThrow();
    expect(() => assertPublicHttpUrl("http://example.org:8443/x")).not.toThrow();
    expect(() => assertPublicHttpUrl("https://8.8.8.8/x")).not.toThrow();
    expect(() => assertPublicHttpUrl("https://[2606:4700:4700::1111]/x")).not.toThrow();
    await expect(verifyWebhookUrl("https://hooks.example.com/x", { lookup: PUBLIC })).resolves.toBeInstanceOf(URL);
  });

  it.each([
    "http://localhost/x",
    "https://127.0.0.1/x",
    "http://127.1/x",
    "http://2130706433/x",
    "http://0x7f.1/x",
    "http://0.0.0.0/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.100.100.200/latest/meta-data/",
    "http://100.64.0.1/x",
    "https://10.0.0.5/x",
    "http://172.16.4.4/x",
    "http://192.168.1.1/x",
    "http://198.18.0.1/x",
    "http://224.0.0.1/x",
    "https://service.local/x",
    "https://api.internal/x",
    "http://metadata/x",
    "https://[::1]/x",
    "http://[::]/x",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:169.254.169.254]/latest/meta-data/iam/security-credentials/",
    "http://[0:0:0:0:0:ffff:7f00:1]/",
    "http://[::ffff:10.0.0.1]/",
    "http://[64:ff9b::a9fe:a9fe]/",
    "http://[2002:7f00:1::]/",
    "http://[fd00::1]/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
    "http://[ff02::1]/",
    "https://user:pass@example.com/x",
    "http://example.com:22/x",
    "http://example.com:25/x"
  ])("blocks %s", (u) => {
    expect(() => assertPublicHttpUrl(u)).toThrow(/^Webhook: /);
  });

  it("rejects non-http(s) protocols and invalid URLs", () => {
    expect(() => assertPublicHttpUrl("ftp://example.com")).toThrow(/http/);
    expect(() => assertPublicHttpUrl("file:///etc/passwd")).toThrow(/http/);
    expect(() => assertPublicHttpUrl("not a url")).toThrow(/valid URL/);
  });
});
