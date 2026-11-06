/**
 * F21 / UI-004: the SEO audit fetches merchant-supplied URLs only through the shared outbound
 * guard (lib/security/outbound-http.ts) — https only, public addresses only (every hop,
 * re-resolved), same-site redirects only, capped redirects / time / decompressed size.
 */
import http from "node:http";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OutboundUrlError, type LookupAll } from "@/lib/security/outbound-http";
import {
  decodeBody,
  fetchPublicPage,
  nodePageTransport,
  PageFetchError,
  sameSite,
  type PageResponse,
  type PageTransport
} from "@/lib/seo/fetch-page";

const PUBLIC = "93.184.215.14";
const publicLookup: LookupAll = async () => [{ address: PUBLIC, family: 4 }];
const html = (body = "<title>ok</title>") => Buffer.from(`<html><head>${body}</head></html>`);

function scripted(responses: Array<Partial<PageResponse>>) {
  const seen: Array<{ url: string; address: string }> = [];
  const transport: PageTransport = async ({ url, address }) => {
    seen.push({ url: url.toString(), address: address.address });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return { status: 200, headers: { "content-type": "text/html" }, body: html(), truncated: false, ...next };
  };
  return { transport, seen };
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof OutboundUrlError) return `guard:${err.reason}`;
    if (err instanceof PageFetchError) return `fetch:${err.reason}`;
    throw err;
  }
  return "fetched";
}

describe("SSRF guard (every refusal happens before any request)", () => {
  const never: PageTransport = async () => {
    throw new Error("the transport must not be reached");
  };

  it.each([
    ["http://bayt-oud.example/", publicLookup, "guard:scheme"],
    ["ftp://bayt-oud.example/", publicLookup, "guard:scheme"],
    ["https://127.0.0.1/", publicLookup, "guard:blocked_address"],
    ["https://[::1]/", publicLookup, "guard:blocked_address"],
    ["https://169.254.169.254/latest/meta-data/", publicLookup, "guard:blocked_address"],
    ["https://localhost/", publicLookup, "guard:blocked_host"],
    ["https://metadata.google.internal/", publicLookup, "guard:blocked_host"],
    ["https://intranet/", publicLookup, "guard:blocked_host"],
    ["https://user:pw@bayt-oud.example/", publicLookup, "guard:credentials"],
    ["https://bayt-oud.example:22/", publicLookup, "guard:port"],
    ["https://bayt-oud.example:6379/", publicLookup, "guard:port"],
    ["https://rebind.example/", (async () => [{ address: "10.0.0.7", family: 4 }]) as LookupAll, "guard:blocked_address"],
    ["https://mapped.example/", (async () => [{ address: "::ffff:192.168.1.1", family: 6 }]) as LookupAll, "guard:blocked_address"],
    [
      "https://mixed.example/",
      (async () => [
        { address: PUBLIC, family: 4 },
        { address: "100.100.100.200", family: 4 }
      ]) as LookupAll,
      "guard:blocked_address"
    ],
    ["https://nxdomain.example/", (async () => []) as LookupAll, "guard:dns_failed"]
  ])("%s → %s", async (url, lookup, expected) => {
    expect(await refusal(fetchPublicPage(url, { lookup, transport: never }))).toBe(expected);
  });
});

describe("redirects", () => {
  it("follows same-site redirects (incl. www) and connects to the checked address", async () => {
    const { transport, seen } = scripted([
      { status: 301, headers: { location: "https://www.bayt-oud.example/ar" } },
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: html("<title>متجر</title>") }
    ]);
    const res = await fetchPublicPage("https://bayt-oud.example/", { lookup: publicLookup, transport });
    expect(res.status).toBe(200);
    expect(res.finalUrl).toBe("https://www.bayt-oud.example/ar");
    expect(res.redirects).toEqual(["https://www.bayt-oud.example/ar"]);
    expect(res.html).toContain("متجر");
    expect(seen.map((s) => s.address)).toEqual([PUBLIC, PUBLIC]);
  });

  it("re-validates every hop: a same-site redirect that now resolves privately is refused", async () => {
    let n = 0;
    const flipping: LookupAll = async () => (n++ === 0 ? [{ address: PUBLIC, family: 4 }] : [{ address: "127.0.0.1", family: 4 }]);
    const { transport } = scripted([{ status: 302, headers: { location: "/again" } }]);
    expect(await refusal(fetchPublicPage("https://bayt-oud.example/", { lookup: flipping, transport }))).toBe("guard:blocked_address");
  });

  it("refuses off-site, insecure, invalid and endless redirects", async () => {
    const offsite = scripted([{ status: 302, headers: { location: "https://169.254.169.254/" } }]);
    const err = await fetchPublicPage("https://bayt-oud.example/", { lookup: publicLookup, transport: offsite.transport }).catch((e) => e);
    expect(err).toBeInstanceOf(PageFetchError);
    expect((err as PageFetchError).reason).toBe("redirect_offsite");
    expect((err as PageFetchError).target).toBe("169.254.169.254");

    const otherPort = scripted([{ status: 302, headers: { location: "https://bayt-oud.example:8443/admin" } }]);
    expect(await refusal(fetchPublicPage("https://bayt-oud.example/", { lookup: publicLookup, transport: otherPort.transport }))).toBe(
      "guard:port"
    );

    const insecure = scripted([{ status: 301, headers: { location: "http://bayt-oud.example/" } }]);
    expect(await refusal(fetchPublicPage("https://bayt-oud.example/", { lookup: publicLookup, transport: insecure.transport }))).toBe(
      "fetch:insecure_redirect"
    );

    const bad = scripted([{ status: 301, headers: { location: "https://[bad" } }]);
    expect(await refusal(fetchPublicPage("https://bayt-oud.example/", { lookup: publicLookup, transport: bad.transport }))).toBe(
      "fetch:bad_redirect"
    );

    const loop = scripted(Array.from({ length: 10 }, () => ({ status: 302, headers: { location: "/loop" } })));
    expect(
      await refusal(fetchPublicPage("https://bayt-oud.example/", { lookup: publicLookup, transport: loop.transport, maxRedirects: 3 }))
    ).toBe("fetch:too_many_redirects");
    expect(loop.seen).toHaveLength(4);
  });

  it("returns non-200 answers and non-HTML bodies for the audit to report", async () => {
    const { transport } = scripted([{ status: 503, headers: { "content-type": "application/json" }, body: Buffer.from("{}") }]);
    const res = await fetchPublicPage("https://bayt-oud.example/", { lookup: publicLookup, transport });
    expect(res.status).toBe(503);
    expect(res.html).toBeNull();
  });

  it("treats a leading www. as the same site and nothing else", () => {
    expect(sameSite("www.bayt-oud.example", "bayt-oud.example")).toBe(true);
    expect(sameSite("BAYT-OUD.example.", "www.bayt-oud.example")).toBe(true);
    expect(sameSite("shop.bayt-oud.example", "bayt-oud.example")).toBe(false);
    expect(sameSite("bayt-oud.example.evil.example", "bayt-oud.example")).toBe(false);
  });

  it("decodes the declared charset", () => {
    const cp1256 = Buffer.from([0xc7, 0xe1, 0xda, 0xe6, 0xcf]); // "العود" in windows-1256
    expect(decodeBody(cp1256, "text/html; charset=windows-1256")).toBe("العود");
    expect(decodeBody(Buffer.from("ok"), "text/html; charset=made-up")).toBe("ok");
  });
});

describe("nodePageTransport (real sockets, local server)", () => {
  let server: http.Server;
  let base: URL;
  const big = "x".repeat(200_000);

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/gzip") {
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
        res.end(zlib.gzipSync(Buffer.from("<title>مضغوط</title>")));
      } else if (req.url === "/bomb") {
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
        res.end(zlib.gzipSync(Buffer.alloc(5_000_000, 0x41)));
      } else if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(big);
      } else if (req.url === "/slow") {
        res.writeHead(200, { "content-type": "text/html" });
        res.write("<title>");
        // never finishes
      } else if (req.url === "/weird") {
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "compress" });
        res.end("data");
      } else if (req.url === "/redirect") {
        res.writeHead(302, { location: "/gzip" });
        res.end("moved");
      } else {
        res.writeHead(200, { "content-type": "text/html", "x-robots-tag": "noindex" });
        res.end(`<title>${req.headers["user-agent"]}</title>`);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  const call = (path: string, init: { timeoutMs?: number; maxBytes?: number } = {}) =>
    nodePageTransport(
      { url: new URL(path, base), address: { address: "127.0.0.1", family: 4 } },
      { headers: { "user-agent": "arabclue-test" }, timeoutMs: init.timeoutMs ?? 2_000, maxBytes: init.maxBytes ?? 64_000 }
    );

  it("sends the request headers and returns status, headers and body", async () => {
    const res = await call("/");
    expect(res.status).toBe(200);
    expect(res.headers["x-robots-tag"]).toBe("noindex");
    expect(res.body.toString()).toBe("<title>arabclue-test</title>");
  });

  it("decompresses gzip", async () => {
    expect((await call("/gzip")).body.toString()).toBe("<title>مضغوط</title>");
  });

  it("caps the body AFTER decompression (compression bombs stop at maxBytes)", async () => {
    const res = await call("/bomb", { maxBytes: 100_000 });
    expect(res.truncated).toBe(true);
    expect(res.body.length).toBe(100_000);
  });

  it("caps plain bodies and flags truncation", async () => {
    const res = await call("/big", { maxBytes: 50_000 });
    expect(res.truncated).toBe(true);
    expect(res.body.length).toBe(50_000);
    expect((await call("/big", { maxBytes: 500_000 })).truncated).toBe(false);
  });

  it("times out a response that never finishes", async () => {
    const err = await call("/slow", { timeoutMs: 300 }).catch((e) => e);
    expect(err).toBeInstanceOf(PageFetchError);
    expect((err as PageFetchError).reason).toBe("timeout");
  });

  it("refuses unsupported content encodings and does not read redirect bodies", async () => {
    const err = await call("/weird").catch((e) => e);
    expect((err as PageFetchError).reason).toBe("decode_failed");
    const redirect = await call("/redirect");
    expect(redirect.status).toBe(302);
    expect(redirect.headers.location).toBe("/gzip");
    expect(redirect.body.length).toBe(0);
  });
});
