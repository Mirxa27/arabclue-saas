/**
 * GET a merchant-supplied page for the SEO site audit, under the shared outbound guard.
 *
 * Every hop goes through resolvePublicHttpTarget (lib/security/outbound-http.ts — public
 * addresses only, no userinfo, no internal names, DNS checked once and the connection pinned
 * to the checked address so rebinding cannot redirect it). On top of that the audit is
 * stricter than the webhook sender:
 *   - https only, on every hop;
 *   - redirects are followed only within the same site (the host, ignoring a leading
 *     "www."), at most `maxRedirects` times, each one re-validated by the guard;
 *   - each hop has a time cap covering the body read, and the body is read only up to
 *     `maxBytes` AFTER decompression (gzip / deflate / br), so a compression bomb cannot
 *     exhaust memory; a longer page is truncated and flagged.
 * The body is parsed for the audit and never returned to the client verbatim.
 *
 * Server-only (node:http / node:https / node:zlib).
 */
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import zlib from "node:zlib";
import type { Readable } from "node:stream";
import { OutboundUrlError, resolvePublicHttpTarget, type LookupAll, type ResolvedAddress } from "@/lib/security/outbound-http";

export const PAGE_FETCH_TIMEOUT_MS = 10_000;
export const PAGE_FETCH_MAX_BYTES = 1_500_000;
export const PAGE_FETCH_MAX_REDIRECTS = 3;
export const AUDIT_USER_AGENT = "arabclue-seo-audit/1.0 (+https://arabclue.com)";

export type PageFetchFailure =
  | "timeout"
  | "network"
  | "too_many_redirects"
  | "redirect_offsite"
  | "insecure_redirect"
  | "bad_redirect"
  | "decode_failed";

/** The page could not be fetched. The message is safe to show (no response content). */
export class PageFetchError extends Error {
  readonly reason: PageFetchFailure;
  /** For redirect_offsite: the host the page tried to send us to. */
  readonly target?: string;
  constructor(reason: PageFetchFailure, message: string, target?: string) {
    super(message);
    this.name = "PageFetchError";
    this.reason = reason;
    this.target = target;
  }
}

export type PageResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  body: Buffer;
  truncated: boolean;
};

export type PageRequestInit = { headers: Record<string, string>; timeoutMs: number; maxBytes: number };

/** One HTTP exchange with an already-validated, pinned address (the test seam). */
export type PageTransport = (target: { url: URL; address: ResolvedAddress }, init: PageRequestInit) => Promise<PageResponse>;

export type FetchPageOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  lookup?: LookupAll;
  transport?: PageTransport;
};

export type FetchedPage = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  /** Decoded body, only for HTML responses. */
  html: string | null;
  truncated: boolean;
  redirects: string[];
  xRobotsTag: string | null;
};

function hostOf(u: URL): string {
  return u.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

/** Same site for the audit: equal hosts, ignoring one leading "www.". */
export function sameSite(a: string, b: string): boolean {
  const norm = (h: string) => h.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  return norm(a) === norm(b);
}

function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  return headers[name.toLowerCase()];
}

export function isHtmlContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return true; // many servers omit it for HTML; the scanner copes with anything
  const type = contentType.split(";")[0].trim().toLowerCase();
  return type === "text/html" || type === "application/xhtml+xml";
}

export function decodeBody(body: Buffer, contentType: string | null | undefined): string {
  const label = /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType ?? "")?.[1]?.toLowerCase() ?? "utf-8";
  try {
    return new TextDecoder(label, { fatal: false }).decode(body);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(body);
  }
}

function flattenHeaders(raw: http.IncomingHttpHeaders): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  return out;
}

/** The production transport: node http(s) pinned to the checked address, body capped after decoding. */
export const nodePageTransport: PageTransport = ({ url, address }, init) => {
  const isHttps = url.protocol === "https:";
  const transport = isHttps ? https : http;
  const host = hostOf(url);
  const literal = isIP(host) !== 0;

  return new Promise<PageResponse>((resolve, reject) => {
    const signal = AbortSignal.timeout(init.timeoutMs);
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const onError = (err: NodeJS.ErrnoException) =>
      fail(
        signal.aborted
          ? new PageFetchError("timeout", `the page did not respond within ${Math.round(init.timeoutMs / 1000)} s`)
          : new PageFetchError("network", `the page could not be reached (${err.code ?? err.name})`)
      );

    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: literal ? address.address : host,
        port: url.port ? Number(url.port) : isHttps ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: init.headers,
        // Connect to the address that was checked, never a fresh resolution.
        lookup: (_hostname, options, callback) => {
          const cb = callback as unknown as (
            err: NodeJS.ErrnoException | null,
            addr: string | Array<{ address: string; family: number }>,
            family?: number
          ) => void;
          if ((options as { all?: boolean } | undefined)?.all) cb(null, [{ address: address.address, family: address.family }]);
          else cb(null, address.address, address.family);
        },
        ...(isHttps && !literal ? { servername: host } : {}),
        signal,
        agent: false
      },
      (res) => {
        const headers = flattenHeaders(res.headers);
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          // Redirect: the body is irrelevant.
          res.resume();
          settled = true;
          resolve({ status, headers, body: Buffer.alloc(0), truncated: false });
          req.destroy();
          return;
        }

        const encoding = (headers["content-encoding"] ?? "").trim().toLowerCase();
        let stream: Readable = res;
        if (encoding === "gzip" || encoding === "x-gzip") stream = res.pipe(zlib.createGunzip());
        else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
        else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());
        else if (encoding && encoding !== "identity") {
          res.destroy();
          fail(new PageFetchError("decode_failed", `the page used an unsupported content encoding (${encoding.slice(0, 20)})`));
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        const finish = (truncated: boolean) => {
          if (settled) return;
          settled = true;
          const body = Buffer.concat(chunks);
          resolve({ status, headers, body: body.length > init.maxBytes ? body.subarray(0, init.maxBytes) : body, truncated });
        };
        stream.on("data", (chunk: Buffer) => {
          if (settled) return;
          chunks.push(chunk);
          size += chunk.length;
          if (size >= init.maxBytes) {
            finish(true);
            stream.destroy();
            res.destroy();
            req.destroy();
          }
        });
        stream.on("end", () => finish(false));
        stream.on("error", (err: NodeJS.ErrnoException) => {
          if (settled) return;
          if (stream !== res) fail(new PageFetchError("decode_failed", "the page's compressed body could not be decoded"));
          else onError(err);
        });
        res.on("error", onError);
        // A connection that drops mid-body closes the response without completing it.
        res.on("close", () => {
          if (!res.complete) onError(Object.assign(new Error("connection closed"), { code: "ECONNRESET" }));
        });
      }
    );
    req.on("error", onError);
    req.end();
  });
};

/**
 * Fetch `rawUrl` (https) for the audit. Throws OutboundUrlError when the guard refuses a hop
 * (scheme, private address, internal host, DNS failure) and PageFetchError for transport,
 * redirect or decoding failures. Any HTTP status is returned (the audit reports non-200s).
 */
export async function fetchPublicPage(rawUrl: string, opts: FetchPageOptions = {}): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? PAGE_FETCH_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? PAGE_FETCH_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? PAGE_FETCH_MAX_REDIRECTS;
  const transport = opts.transport ?? nodePageTransport;
  const headers = {
    "user-agent": AUDIT_USER_AGENT,
    accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
    "accept-language": "ar,en;q=0.8",
    "accept-encoding": "gzip, deflate, br"
  };

  const redirects: string[] = [];
  let current = rawUrl;
  let originHost: string | null = null;

  for (let hop = 0; ; hop += 1) {
    const { url, target } = await resolvePublicHttpTarget(current, { lookup: opts.lookup });
    if (url.protocol !== "https:") throw new OutboundUrlError("scheme", "url must be https");
    // A storefront is served on the default https port; anything else is not a page to audit.
    if (url.port && url.port !== "443") throw new OutboundUrlError("port", "url must use the default https port");
    originHost ??= hostOf(url);

    const res = await transport({ url, address: target }, { headers, timeoutMs, maxBytes });

    const location = header(res.headers, "location");
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= maxRedirects) {
        throw new PageFetchError("too_many_redirects", `the page redirected more than ${maxRedirects} times`);
      }
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new PageFetchError("bad_redirect", "the page sent an invalid redirect");
      }
      if (next.protocol !== "https:") throw new PageFetchError("insecure_redirect", "the page redirects to an insecure (http) address");
      if (!sameSite(hostOf(next), originHost)) {
        throw new PageFetchError("redirect_offsite", "the page redirects to another site", hostOf(next).slice(0, 253));
      }
      next.hash = "";
      redirects.push(next.toString());
      current = next.toString();
      continue;
    }

    const contentType = header(res.headers, "content-type") ?? null;
    return {
      requestedUrl: rawUrl,
      finalUrl: url.toString(),
      status: res.status,
      contentType,
      html: isHtmlContentType(contentType) ? decodeBody(res.body, contentType) : null,
      truncated: res.truncated,
      redirects,
      xRobotsTag: header(res.headers, "x-robots-tag") ?? null
    };
  }
}
