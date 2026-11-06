/**
 * Outbound requests to URLs a tenant controls (SW-4) — one hardened guard.
 *
 *  - URL text: http(s) only, no userinfo, ports 80/443 or ≥ 1024, no internal names.
 *  - Addresses: every A/AAAA record (or the IP literal) must be global unicast. IPv4-mapped
 *    (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d), NAT64 (64:ff9b::/96) and 6to4 (2002::/16)
 *    IPv6 forms are judged by the IPv4 address they embed. Blocked: 0/8, 10/8, 100.64/10
 *    (CGNAT, incl. 100.100.100.200 metadata), 127/8, 169.254/16 (link-local incl.
 *    169.254.169.254), 172.16/12, 192.0.0/24, 192.0.2/24, 192.88.99/24, 192.168/16,
 *    198.18/15, 198.51.100/24, 203.0.113/24, 224/4 and above; ::, ::1, 64:ff9b:1::/48,
 *    100::/64, 2001::/23, 2001:db8::/32, fc00::/7 (incl. fd00::/8), fe80::/10, fec0::/10,
 *    ff00::/8.
 *  - The connection is pinned to the address that was checked (custom `lookup`), so DNS
 *    rebinding between the check and the connect cannot redirect it; TLS still verifies the
 *    certificate against the hostname.
 *  - Redirects are never followed (a 3xx is a failed delivery), the request has a time cap,
 *    and the response body is read only up to a small cap and then discarded — it is never
 *    returned, so it cannot be echoed to a user, a log or a model.
 *
 * Server-only (node:http / node:https / node:dns).
 */
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { expandIpv6 } from "@/lib/security/rate-limit";

export type OutboundRefusal =
  | "invalid_url"
  | "scheme"
  | "credentials"
  | "port"
  | "blocked_host"
  | "blocked_address"
  | "dns_failed";

/** The URL may not be fetched. The message is safe to show (it never contains a response body). */
export class OutboundUrlError extends Error {
  readonly reason: OutboundRefusal;
  constructor(reason: OutboundRefusal, message: string) {
    super(message);
    this.name = "OutboundUrlError";
    this.reason = reason;
  }
}

// ─── address classification ────────────────────────────────────────────────

type V4Range = [base: number, prefix: number];

function v4ToInt(a: number, b: number, c: number, d: number): number {
  return ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
}

const V4_BLOCKED: V4Range[] = (
  [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 3] // 224/4 multicast + 240/4 reserved + 255.255.255.255
  ] as const
).map(([ip, prefix]) => {
  const [a, b, c, d] = ip.split(".").map(Number);
  return [v4ToInt(a, b, c, d), prefix];
});

function v4Blocked(n: number): boolean {
  return V4_BLOCKED.some(([base, prefix]) => {
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return ((n & mask) >>> 0) === ((base & mask) >>> 0);
  });
}

function parseV4(address: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return v4ToInt(parts[0], parts[1], parts[2], parts[3]);
}

/** groups: eight 16-bit numbers. Prefix match on the first `bits` bits. */
function v6InPrefix(groups: number[], prefix: number[], bits: number): boolean {
  for (let i = 0; i < 8 && bits > 0; i++) {
    const take = Math.min(16, bits);
    const mask = take === 16 ? 0xffff : (0xffff << (16 - take)) & 0xffff;
    if ((groups[i] & mask) !== ((prefix[i] ?? 0) & mask)) return false;
    bits -= take;
  }
  return true;
}

const V6_BLOCKED: Array<[number[], number]> = [
  [[0, 0, 0, 0, 0, 0, 0, 0], 128], // ::
  [[0, 0, 0, 0, 0, 0, 0, 1], 128], // ::1
  [[0x64, 0xff9b, 1], 48], // local-use NAT64
  [[0x100, 0, 0, 0], 64], // discard-only
  [[0x2001, 0], 23], // IETF protocol assignments (Teredo, ORCHID, …)
  [[0x2001, 0xdb8], 32], // documentation
  [[0xfc00], 7], // unique local (fc00::/8 + fd00::/8)
  [[0xfe80], 10], // link-local
  [[0xfec0], 10], // site-local (deprecated)
  [[0xff00], 8] // multicast
];

/** The IPv4 address an IPv6 address stands for (mapped, compatible, NAT64, 6to4), if any. */
function embeddedV4(groups: number[]): number | null {
  const hi = (a: number, b: number) => ((a << 16) >>> 0) + b;
  const zeros = (from: number, to: number) => groups.slice(from, to).every((g) => g === 0);
  if (zeros(0, 5) && groups[5] === 0xffff) return hi(groups[6], groups[7]); // ::ffff:a.b.c.d
  if (zeros(0, 6) && !(groups[6] === 0 && groups[7] <= 1)) return hi(groups[6], groups[7]); // ::a.b.c.d
  if (groups[0] === 0x64 && groups[1] === 0xff9b && zeros(2, 6)) return hi(groups[6], groups[7]); // 64:ff9b::/96
  if (groups[0] === 0x2002) return hi(groups[1], groups[2]); // 2002:AABB:CCDD::/48
  return null;
}

/** True only for a global unicast IPv4/IPv6 address (any textual form). */
export function isPublicIpAddress(raw: string): boolean {
  let address = raw.trim().toLowerCase();
  if (address.startsWith("[") && address.endsWith("]")) address = address.slice(1, -1);
  const zone = address.indexOf("%");
  if (zone >= 0) return false; // scoped (link-local) addresses are never public
  const v4 = parseV4(address);
  if (v4 !== null) return !v4Blocked(v4);
  if (isIP(address) !== 6) return false;
  const groups = expandIpv6(address);
  if (!groups) return false;
  const embedded = embeddedV4(groups);
  if (embedded !== null) return !v4Blocked(embedded);
  if (V6_BLOCKED.some(([prefix, bits]) => v6InPrefix(groups, prefix, bits))) return false;
  // Only 2000::/3 is allocated global unicast.
  return (groups[0] & 0xe000) === 0x2000;
}

// ─── URL checks ────────────────────────────────────────────────────────────

const INTERNAL_NAME = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/;

function hostOf(u: URL): string {
  return u.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

/** Synchronous checks on the URL text. Throws OutboundUrlError; returns the parsed URL. */
export function parsePublicHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new OutboundUrlError("invalid_url", "url is not a valid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new OutboundUrlError("scheme", "url must be http(s)");
  if (u.username || u.password) throw new OutboundUrlError("credentials", "url must not contain a username or password");
  if (u.port) {
    const port = Number(u.port);
    if (!(port === 80 || port === 443 || (port >= 1024 && port <= 65535))) {
      throw new OutboundUrlError("port", "url port must be 80, 443 or 1024-65535");
    }
  }
  const host = hostOf(u);
  if (!host) throw new OutboundUrlError("invalid_url", "url has no host");
  if (isIP(host)) {
    if (!isPublicIpAddress(host)) throw new OutboundUrlError("blocked_address", "url points to a private or reserved address");
  } else if (INTERNAL_NAME.test(host) || !host.includes(".") || host.endsWith(".")) {
    throw new OutboundUrlError("blocked_host", "url points to an internal host name");
  }
  return u;
}

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type LookupAll = (hostname: string) => Promise<ResolvedAddress[]>;

const systemLookup: LookupAll = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

/**
 * Resolve the URL's host and verify every address is public. Returns the address the
 * connection must use. A host with any non-public record is refused (no partial trust).
 */
export async function resolvePublicHttpTarget(
  raw: string,
  opts: { lookup?: LookupAll } = {}
): Promise<{ url: URL; target: ResolvedAddress }> {
  const url = parsePublicHttpUrl(raw);
  const host = hostOf(url);
  const literal = isIP(host);
  if (literal) return { url, target: { address: host, family: literal === 6 ? 6 : 4 } };

  let records: ResolvedAddress[];
  try {
    records = await (opts.lookup ?? systemLookup)(host);
  } catch {
    throw new OutboundUrlError("dns_failed", "url host could not be resolved");
  }
  if (records.length === 0) throw new OutboundUrlError("dns_failed", "url host could not be resolved");
  if (records.some((r) => !isPublicIpAddress(r.address))) {
    throw new OutboundUrlError("blocked_address", "url host resolves to a private or reserved address");
  }
  return { url, target: records[0] };
}

// ─── request ───────────────────────────────────────────────────────────────

/** Headers a tenant may not set (framing, routing, hop-by-hop). */
const FORBIDDEN_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  "expect",
  "proxy-authorization",
  "proxy-connection"
]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/;
const MAX_TENANT_HEADERS = 20;
const MAX_HEADER_VALUE = 1024;

/** Tenant-supplied headers, minus anything that could change how the request is framed or routed. */
export function sanitizeTenantHeaders(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  let n = 0;
  for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
    if (n >= MAX_TENANT_HEADERS) break;
    const lower = name.toLowerCase();
    if (!HEADER_NAME.test(name) || FORBIDDEN_HEADERS.has(lower) || lower.startsWith("proxy-")) continue;
    if (typeof value !== "string" || value.length > MAX_HEADER_VALUE || /[\r\n\0]/.test(value)) continue;
    out[lower] = value;
    n += 1;
  }
  return out;
}

export type PublicRequestInit = {
  method?: "POST" | "PUT";
  headers: Record<string, string>;
  body: string;
  /** Whole-request cap (connect + response headers). Default 10 s. */
  timeoutMs?: number;
  /** How much of the response body is read (then discarded). Default 64 KiB. */
  maxResponseBytes?: number;
  lookup?: LookupAll;
};

export type PublicRequestResult = { status: number };

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * Send a request to a tenant-controlled URL under the guard. Resolves with the status for
 * any HTTP answer (the caller decides what counts as delivered; a 3xx is never followed);
 * rejects with OutboundUrlError for a refused target, or an Error for a network failure /
 * timeout. The response body is never returned.
 */
export async function requestPublicUrl(raw: string, init: PublicRequestInit): Promise<PublicRequestResult> {
  const { url, target } = await resolvePublicHttpTarget(raw, { lookup: init.lookup });
  const isHttps = url.protocol === "https:";
  const transport = isHttps ? https : http;
  const body = Buffer.from(init.body, "utf8");
  const host = hostOf(url);
  const literal = isIP(host) !== 0;
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = init.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  return await new Promise<PublicRequestResult>((resolve, reject) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: literal ? target.address : host,
        port: url.port ? Number(url.port) : isHttps ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        method: init.method ?? "POST",
        headers: { ...init.headers, "content-length": String(body.length) },
        // Connect to the address that was checked, never a fresh resolution.
        lookup: (_hostname, options, callback) => {
          const cb = callback as unknown as (
            err: NodeJS.ErrnoException | null,
            address: string | Array<{ address: string; family: number }>,
            family?: number
          ) => void;
          if ((options as { all?: boolean } | undefined)?.all) cb(null, [{ address: target.address, family: target.family }]);
          else cb(null, target.address, target.family);
        },
        ...(isHttps && !literal ? { servername: host } : {}),
        signal,
        agent: false
      },
      (res) => {
        let seen = 0;
        res.on("data", (chunk: Buffer) => {
          seen += chunk.length;
          if (seen > maxBytes) res.destroy();
        });
        const done = () => resolve({ status: res.statusCode ?? 0 });
        res.on("end", done);
        res.on("close", done);
        res.on("error", done);
      }
    );
    req.on("error", (err) => {
      reject(
        signal.aborted
          ? new Error(`request timed out after ${timeoutMs} ms`)
          : new Error(`request failed: ${(err as NodeJS.ErrnoException).code ?? err.name}`)
      );
    });
    req.end(body);
  });
}
