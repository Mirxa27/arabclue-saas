/**
 * Minimal DER (ITU-T X.690) encoder and decoder — exactly what ZATCA onboarding and signing need:
 * PKCS#10 certificate signing requests (lib/zatca/csr.ts) and reading the X.509 certificate ZATCA
 * issues (issuer, serial number, public key, the CA's signature for QR tag 9 — lib/zatca/certificate.ts).
 *
 * Deliberately small and strict: definite lengths only, no BER, no indefinite forms. Every decoded
 * node keeps its exact byte range so callers can re-hash or re-emit the original encoding.
 */

export const TAG = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  UTF8_STRING: 0x0c,
  PRINTABLE_STRING: 0x13,
  IA5_STRING: 0x16,
  UTC_TIME: 0x17,
  GENERALIZED_TIME: 0x18,
  SEQUENCE: 0x30,
  SET: 0x31
} as const;

export class DerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DerError";
  }
}

// ── encoding ───────────────────────────────────────────────────────────────

export function encodeLength(length: number): Buffer {
  if (!Number.isInteger(length) || length < 0) throw new DerError(`invalid DER length ${length}`);
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  for (let n = length; n > 0; n = Math.floor(n / 256)) bytes.unshift(n & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/** One TLV with an explicit identifier octet (single-byte tags only, which is all we use). */
export function tlv(tag: number, content: Buffer): Buffer {
  if (!Number.isInteger(tag) || tag < 0 || tag > 0xff || (tag & 0x1f) === 0x1f) throw new DerError(`unsupported tag ${tag}`);
  return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content]);
}

export function sequence(...items: Buffer[]): Buffer {
  return tlv(TAG.SEQUENCE, Buffer.concat(items));
}

/** SET OF: DER requires the encoded elements in ascending byte order (X.690 §11.6). */
export function setOf(...items: Buffer[]): Buffer {
  const sorted = [...items].sort(Buffer.compare);
  return tlv(TAG.SET, Buffer.concat(sorted));
}

/** Non-negative INTEGER from a number, bigint or unsigned big-endian bytes. */
export function integer(value: number | bigint | Buffer): Buffer {
  let bytes: Buffer;
  if (Buffer.isBuffer(value)) {
    bytes = value;
  } else {
    let n = BigInt(value);
    if (n < 0n) throw new DerError("negative INTEGER is not supported");
    const out: number[] = [];
    do {
      out.unshift(Number(n & 0xffn));
      n >>= 8n;
    } while (n > 0n);
    bytes = Buffer.from(out);
  }
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  bytes = bytes.subarray(start);
  if (bytes.length === 0) bytes = Buffer.from([0]);
  if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return tlv(TAG.INTEGER, bytes);
}

export function oid(dotted: string): Buffer {
  const arcs = dotted.split(".").map((a) => {
    if (!/^\d+$/.test(a)) throw new DerError(`invalid OID ${dotted}`);
    return BigInt(a);
  });
  if (arcs.length < 2 || arcs[0] > 2n || (arcs[0] < 2n && arcs[1] > 39n)) throw new DerError(`invalid OID ${dotted}`);
  const out: number[] = [];
  const pushArc = (arc: bigint) => {
    const chunk: number[] = [Number(arc & 0x7fn)];
    for (let n = arc >> 7n; n > 0n; n >>= 7n) chunk.unshift(Number(n & 0x7fn) | 0x80);
    out.push(...chunk);
  };
  pushArc(arcs[0] * 40n + arcs[1]);
  for (const arc of arcs.slice(2)) pushArc(arc);
  return tlv(TAG.OID, Buffer.from(out));
}

/** PrintableString: A–Z a–z 0–9 space ' ( ) + , - . / : = ? only. */
export const PRINTABLE = /^[A-Za-z0-9 '()+,\-./:=?]*$/;

export function printableString(value: string): Buffer {
  if (!PRINTABLE.test(value)) throw new DerError(`not a PrintableString: ${JSON.stringify(value)}`);
  return tlv(TAG.PRINTABLE_STRING, Buffer.from(value, "ascii"));
}

export function utf8String(value: string): Buffer {
  return tlv(TAG.UTF8_STRING, Buffer.from(value, "utf8"));
}

export function octetString(content: Buffer): Buffer {
  return tlv(TAG.OCTET_STRING, content);
}

export function bitString(content: Buffer, unusedBits = 0): Buffer {
  if (unusedBits < 0 || unusedBits > 7) throw new DerError("invalid unused-bits count");
  return tlv(TAG.BIT_STRING, Buffer.concat([Buffer.from([unusedBits]), content]));
}

export function boolean(value: boolean): Buffer {
  return tlv(TAG.BOOLEAN, Buffer.from([value ? 0xff : 0x00]));
}

/** [n] EXPLICIT / constructed context-specific wrapper (e.g. directoryName [4] in GeneralName). */
export function contextConstructed(tagNumber: number, content: Buffer): Buffer {
  if (tagNumber < 0 || tagNumber > 30) throw new DerError("context tag out of range");
  return tlv(0xa0 | tagNumber, content);
}

// ── decoding ───────────────────────────────────────────────────────────────

export type DerNode = {
  /** The identifier octet as read (class + constructed bit + tag number). */
  tag: number;
  constructed: boolean;
  /** Offset of the identifier octet within the buffer passed to decodeDer. */
  offset: number;
  /** Length of identifier + length octets. */
  headerLength: number;
  /** Content octets (a view, not a copy). */
  content: Buffer;
  /** The complete TLV (a view). */
  raw: Buffer;
  /** Parsed children of a constructed node. */
  children: DerNode[];
};

function readNode(buf: Buffer, offset: number, depth: number): DerNode {
  if (depth > 32) throw new DerError("DER nesting too deep");
  if (offset + 2 > buf.length) throw new DerError("truncated DER");
  const tag = buf[offset];
  if ((tag & 0x1f) === 0x1f) throw new DerError("multi-byte tags are not supported");
  let length = buf[offset + 1];
  let headerLength = 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0) throw new DerError("indefinite lengths are not DER");
    if (count > 4) throw new DerError("DER length too large");
    if (offset + 2 + count > buf.length) throw new DerError("truncated DER length");
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + buf[offset + 2 + i];
    headerLength += count;
  }
  const start = offset + headerLength;
  const end = start + length;
  if (end > buf.length) throw new DerError("DER content runs past the end of the buffer");
  const constructed = (tag & 0x20) !== 0;
  const content = buf.subarray(start, end);
  const children: DerNode[] = [];
  if (constructed) {
    let cursor = start;
    while (cursor < end) {
      const child = readNode(buf, cursor, depth + 1);
      children.push(child);
      cursor = child.offset + child.raw.length;
    }
    if (cursor !== end) throw new DerError("constructed DER content length mismatch");
  }
  return { tag, constructed, offset, headerLength, content, raw: buf.subarray(offset, end), children };
}

/** Decode exactly one DER value spanning the whole buffer. */
export function decodeDer(buf: Buffer): DerNode {
  const node = readNode(buf, 0, 0);
  if (node.raw.length !== buf.length) throw new DerError("trailing bytes after DER value");
  return node;
}

export function decodeOid(content: Buffer): string {
  const arcs: bigint[] = [];
  let value = 0n;
  for (let i = 0; i < content.length; i++) {
    value = (value << 7n) | BigInt(content[i] & 0x7f);
    if ((content[i] & 0x80) === 0) {
      arcs.push(value);
      value = 0n;
    } else if (i === content.length - 1) {
      throw new DerError("truncated OID");
    }
  }
  if (arcs.length === 0) throw new DerError("empty OID");
  const first = arcs[0];
  const head = first < 40n ? [0n, first] : first < 80n ? [1n, first - 40n] : [2n, first - 80n];
  return [...head, ...arcs.slice(1)].map(String).join(".");
}

/** INTEGER content → unsigned bigint (ZATCA serial numbers are positive). */
export function decodeUnsignedInteger(content: Buffer): bigint {
  let n = 0n;
  for (const byte of content) n = (n << 8n) | BigInt(byte);
  return n;
}

/** Text of a string-type node (UTF8String, PrintableString, IA5String, …). */
export function decodeString(node: DerNode): string {
  switch (node.tag) {
    case TAG.UTF8_STRING:
      return node.content.toString("utf8");
    case TAG.PRINTABLE_STRING:
    case TAG.IA5_STRING:
    case 0x14: // TeletexString — treated as Latin-1
    case 0x1a: // VisibleString
      return node.content.toString("latin1");
    case 0x1e: {
      // BMPString: UTF-16BE
      const swapped = Buffer.from(node.content);
      swapped.swap16();
      return swapped.toString("utf16le");
    }
    default:
      throw new DerError(`not a string type (tag 0x${node.tag.toString(16)})`);
  }
}

export function child(node: DerNode, index: number, expectedTag?: number): DerNode {
  const c = node.children[index];
  if (!c) throw new DerError(`missing DER element #${index}`);
  if (expectedTag !== undefined && c.tag !== expectedTag) {
    throw new DerError(`DER element #${index}: expected tag 0x${expectedTag.toString(16)}, got 0x${c.tag.toString(16)}`);
  }
  return c;
}
