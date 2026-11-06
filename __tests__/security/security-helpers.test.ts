import { describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import { bearerToken, hasBearerSecret, safeEqual } from "@/lib/security/compare";
import { readRawBody, readTextBody } from "@/lib/http/raw-body";
import { HttpError } from "@/lib/api/errors";
import { signMetaPayload, verifyMetaSignature } from "@/lib/webhooks/meta-signature";

const req = (headers: Record<string, string>, body?: BodyInit) =>
  new Request("https://example.test/hook", { method: "POST", headers, body });

describe("safeEqual / bearer secrets", () => {
  it("compares strings in constant time regardless of length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });

  it("extracts bearer tokens case-insensitively", () => {
    expect(bearerToken(req({ authorization: "Bearer s3cret" }))).toBe("s3cret");
    expect(bearerToken(req({ authorization: "bearer   s3cret " }))).toBe("s3cret");
    expect(bearerToken(req({ authorization: "Basic s3cret" }))).toBeNull();
    expect(bearerToken(req({}))).toBeNull();
  });

  it("never authorizes when the secret is unset — 'Bearer undefined' must fail", () => {
    expect(hasBearerSecret(req({ authorization: "Bearer undefined" }), undefined)).toBe(false);
    expect(hasBearerSecret(req({ authorization: "Bearer " }), "")).toBe(false);
    expect(hasBearerSecret(req({ authorization: "Bearer   " }), "   ")).toBe(false);
    expect(hasBearerSecret(req({ authorization: "Bearer null" }), null)).toBe(false);
  });

  it("authorizes only the exact configured secret", () => {
    expect(hasBearerSecret(req({ authorization: "Bearer s3cret" }), "s3cret")).toBe(true);
    expect(hasBearerSecret(req({ authorization: "Bearer s3cre" }), "s3cret")).toBe(false);
    expect(hasBearerSecret(req({}), "s3cret")).toBe(false);
  });
});

describe("readRawBody", () => {
  it("returns the exact bytes under the cap", async () => {
    const body = "{\"text\":\"\\u0645\\u0631\\u062d\\u0628\\u0627\"}";
    expect((await readRawBody(req({}, body), 1000)).toString("utf8")).toBe(body);
    expect(await readTextBody(req({}, "hi"), 10)).toBe("hi");
  });

  it("rejects a declared content-length over the cap with 413 before reading", async () => {
    const err = await readRawBody(req({ "content-length": "5000" }, "x"), 100).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(413);
  });

  it("rejects a streamed body that exceeds the cap even without content-length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 10; i++) controller.enqueue(new Uint8Array(64));
        controller.close();
      }
    });
    const r = new Request("https://example.test/hook", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    const err = await readRawBody(r, 300).catch((e) => e);
    expect((err as HttpError).status).toBe(413);
  });

  it("returns an empty buffer for a bodyless request", async () => {
    expect((await readRawBody(new Request("https://example.test/hook"), 10)).length).toBe(0);
  });
});

describe("verifyMetaSignature (X-Hub-Signature-256)", () => {
  const secret = "app-secret-123";
  // Meta sends Arabic as \u escapes and signs exactly these bytes.
  const raw = Buffer.from('{"object":"page","entry":[{"messaging":[{"message":{"text":"\\u0645\\u0631\\u062d\\u0628\\u0627"}}]}]}');
  const good = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;

  it("accepts the HMAC of the raw bytes", () => {
    expect(verifyMetaSignature(raw, good, secret)).toBe(true);
    expect(signMetaPayload(raw, secret)).toBe(good);
  });

  it("rejects a signature computed over re-serialised JSON (decoded Arabic)", () => {
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(raw.toString("utf8"))));
    expect(reserialised.equals(raw)).toBe(false);
    expect(verifyMetaSignature(raw, signMetaPayload(reserialised, secret), secret)).toBe(false);
  });

  it("rejects wrong secrets, tampered bodies and malformed headers", () => {
    const tampered = Buffer.from(raw);
    tampered[tampered.length - 3] ^= 1;
    expect(verifyMetaSignature(raw, good, "other-secret")).toBe(false);
    expect(verifyMetaSignature(tampered, good, secret)).toBe(false);
    expect(verifyMetaSignature(raw, null, secret)).toBe(false);
    expect(verifyMetaSignature(raw, good.replace("sha256=", ""), secret)).toBe(false);
    expect(verifyMetaSignature(raw, good.replace("sha256=", "sha1="), secret)).toBe(false);
    expect(verifyMetaSignature(raw, good.slice(0, -1), secret)).toBe(false);
    expect(verifyMetaSignature(raw, good + "0", secret)).toBe(false);
    expect(verifyMetaSignature(raw, good.slice(0, -1) + "z", secret)).toBe(false);
    expect(verifyMetaSignature(raw, good, "")).toBe(false);
  });
});
