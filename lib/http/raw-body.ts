/**
 * Read a request body as raw bytes with a hard size cap — for webhook
 * signature checks (which must hash the exact bytes) and to stop oversized
 * payloads before JSON.parse / schema validation run on them.
 */
import { HttpError } from "@/lib/api/errors";

export const WEBHOOK_MAX_BYTES = 1_000_000; // 1 MB — Meta batches up to 1000 updates

export function payloadTooLarge(maxBytes: number): HttpError {
  return new HttpError(413, `Payload too large (max ${maxBytes} bytes)`, "payload_too_large");
}

export async function readRawBody(req: Request, maxBytes: number = WEBHOOK_MAX_BYTES): Promise<Buffer> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw payloadTooLarge(maxBytes);
  if (!req.body) return Buffer.alloc(0);

  const reader = req.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw payloadTooLarge(maxBytes);
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(chunks, total);
}

/** UTF-8 text body with the same cap. */
export async function readTextBody(req: Request, maxBytes: number = WEBHOOK_MAX_BYTES): Promise<string> {
  return (await readRawBody(req, maxBytes)).toString("utf8");
}
