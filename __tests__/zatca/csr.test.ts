/**
 * F14 — EGS key + PKCS#10 CSR (lib/zatca/csr.ts, lib/zatca/der.ts): the structure ZATCA's Developer
 * Portal OpenSSL configuration produces (subject C/OU/O/CN, certificate template name as a
 * PrintableString, subjectAltName dirName SN/UID/title/registeredAddress/businessCategory), a valid
 * self-signature, and input validation. Parsed back with our DER decoder and — when installed — with
 * `openssl req -verify`.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import { createPublicKey, verify } from "crypto";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { buildEgsCsr, CERTIFICATE_TEMPLATE_NAMES, CsrInputError, generateEgsKeyPair, loadEgsPrivateKey, OIDS, validateCsrInput, type EgsCsrInput } from "@/lib/zatca/csr";
import { child, decodeDer, decodeOid, decodeString, encodeLength, integer, oid, setOf, TAG, type DerNode } from "@/lib/zatca/der";

const INPUT: EgsCsrInput = {
  environment: "sandbox",
  commonName: "arabclue-00000000-0000-4000-8000-000000000001",
  organizationName: "شركة بيت العود Bait Al Oud",
  organizationUnit: "Riyadh Branch",
  egsSerialNumber: "1-arabclue|2-salla-v1|3-00000000-0000-4000-8000-000000000001",
  vatNumber: "399999999900003",
  invoiceTypes: "1100",
  location: "1234 King Fahd Rd, Al Olaya, Riyadh 12211",
  industry: "E-commerce"
};

function rdns(name: DerNode): Array<[string, number, string]> {
  return name.children.map((set) => {
    const atv = set.children[0];
    const value = child(atv, 1);
    return [decodeOid(child(atv, 0, TAG.OID).content), value.tag, decodeString(value)];
  });
}

describe("DER primitives", () => {
  it("encodes lengths, integers and OIDs per X.690", () => {
    expect(encodeLength(5).toString("hex")).toBe("05");
    expect(encodeLength(200).toString("hex")).toBe("81c8");
    expect(encodeLength(300).toString("hex")).toBe("82012c");
    expect(integer(0).toString("hex")).toBe("020100");
    expect(integer(128).toString("hex")).toBe("02020080"); // leading zero keeps it positive
    expect(oid("1.2.840.10045.4.3.2").toString("hex")).toBe("06082a8648ce3d040302");
    expect(decodeOid(oid("0.9.2342.19200300.100.1.1").subarray(2))).toBe("0.9.2342.19200300.100.1.1");
  });

  it("sorts SET OF members by their encoding", () => {
    const set = setOf(integer(2), integer(1));
    expect(set.toString("hex")).toBe("3106020101020102");
  });

  it("refuses indefinite lengths and trailing bytes", () => {
    expect(() => decodeDer(Buffer.from("3080", "hex"))).toThrow(/indefinite/);
    expect(() => decodeDer(Buffer.from("02010100", "hex"))).toThrow(/trailing/);
  });
});

describe("buildEgsCsr", () => {
  const keys = generateEgsKeyPair();
  const csr = buildEgsCsr(INPUT, keys.privateKey);
  const root = decodeDer(csr.der);
  const info = child(root, 0, TAG.SEQUENCE);

  it("is a self-signed PKCS#10 request with ecdsa-with-SHA256 over a secp256k1 key", () => {
    expect(csr.pem.startsWith("-----BEGIN CERTIFICATE REQUEST-----\n")).toBe(true);
    expect(Buffer.from(csr.base64Pem, "base64").toString()).toBe(csr.pem);
    expect(decodeOid(child(child(root, 1), 0).content)).toBe(OIDS.ecdsaWithSha256);
    const spki = child(info, 2, TAG.SEQUENCE);
    expect(decodeOid(child(child(spki, 0), 1).content)).toBe(OIDS.secp256k1);
    const key = createPublicKey({ key: spki.raw, format: "der", type: "spki" });
    expect(verify("sha256", info.raw, key, child(root, 2, TAG.BIT_STRING).content.subarray(1))).toBe(true);
    expect(spki.raw.equals(keys.publicKeySpki)).toBe(true);
  });

  it("has the subject C=SA (PrintableString), OU, O, CN (UTF8String)", () => {
    expect(rdns(child(info, 1, TAG.SEQUENCE))).toEqual([
      [OIDS.countryName, TAG.PRINTABLE_STRING, "SA"],
      [OIDS.organizationalUnitName, TAG.UTF8_STRING, INPUT.organizationUnit],
      [OIDS.organizationName, TAG.UTF8_STRING, INPUT.organizationName],
      [OIDS.commonName, TAG.UTF8_STRING, INPUT.commonName]
    ]);
  });

  it("requests the certificate template name and the EGS dirName subjectAltName", () => {
    const attributes = child(info, 3);
    expect(attributes.tag).toBe(0xa0);
    const extReq = attributes.children[0];
    expect(decodeOid(child(extReq, 0, TAG.OID).content)).toBe(OIDS.extensionRequest);
    const exts = child(child(extReq, 1, TAG.SET), 0, TAG.SEQUENCE).children;
    expect(exts.map((e) => decodeOid(child(e, 0, TAG.OID).content))).toEqual([OIDS.certificateTemplateName, OIDS.subjectAltName]);

    const template = decodeDer(child(exts[0], 1, TAG.OCTET_STRING).content);
    expect(template.tag).toBe(TAG.PRINTABLE_STRING);
    expect(decodeString(template)).toBe("TSTZATCA-Code-Signing");

    const san = decodeDer(child(exts[1], 1, TAG.OCTET_STRING).content);
    const dirName = child(san, 0);
    expect(dirName.tag).toBe(0xa4); // [4] directoryName
    expect(rdns(child(dirName, 0, TAG.SEQUENCE))).toEqual([
      [OIDS.surname, TAG.UTF8_STRING, INPUT.egsSerialNumber],
      [OIDS.userId, TAG.UTF8_STRING, INPUT.vatNumber],
      [OIDS.title, TAG.UTF8_STRING, "1100"],
      [OIDS.registeredAddress, TAG.UTF8_STRING, INPUT.location],
      [OIDS.businessCategory, TAG.UTF8_STRING, INPUT.industry]
    ]);
  });

  it("uses the environment's template name", () => {
    expect(CERTIFICATE_TEMPLATE_NAMES).toEqual({ sandbox: "TSTZATCA-Code-Signing", simulation: "PREZATCA-Code-Signing", production: "ZATCA-Code-Signing" });
    const prod = decodeDer(buildEgsCsr({ ...INPUT, environment: "production" }, keys.privateKey).der);
    const ext = child(child(child(child(child(prod, 0), 3), 0), 1), 0).children[0];
    expect(decodeString(decodeDer(child(ext, 1).content))).toBe("ZATCA-Code-Signing");
  });

  it("verifies with openssl and prints ZATCA's fields", () => {
    let available = true;
    try {
      execFileSync("openssl", ["version"], { stdio: "ignore" });
    } catch {
      available = false;
    }
    if (!available) return;
    const dir = mkdtempSync(path.join(tmpdir(), "zatca-csr-"));
    writeFileSync(path.join(dir, "csr.pem"), csr.pem);
    const out = execFileSync("openssl", ["req", "-in", path.join(dir, "csr.pem"), "-noout", "-text", "-verify", "-nameopt", "utf8"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(out).toContain("ASN1 OID: secp256k1");
    expect(out).toContain("Signature Algorithm: ecdsa-with-SHA256");
    expect(out).toContain("1.3.6.1.4.1.311.20.2");
    expect(out).toContain(`DirName:/SN=${INPUT.egsSerialNumber}/UID=${INPUT.vatNumber}/title=1100/registeredAddress=${INPUT.location}/businessCategory=${INPUT.industry}`);
    const verified = execFileSync("openssl", ["req", "-in", path.join(dir, "csr.pem"), "-noout", "-verify"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    void verified; // exit status 0 = "self-signature verify OK"
  });

  it("stores the key as PKCS#8 PEM that loads back as secp256k1", () => {
    expect(keys.privateKeyPem).toContain("BEGIN PRIVATE KEY");
    expect(loadEgsPrivateKey(keys.privateKeyPem).asymmetricKeyDetails?.namedCurve).toBe("secp256k1");
  });
});

describe("validateCsrInput", () => {
  it("accepts the documented shape and refuses the rest", () => {
    expect(validateCsrInput(INPUT)).toEqual([]);
    expect(validateCsrInput({ ...INPUT, vatNumber: "300000000000004" })).toEqual(["vatNumber must be 15 digits starting and ending with 3"]);
    expect(validateCsrInput({ ...INPUT, egsSerialNumber: "arabclue" })[0]).toMatch(/1-…\|2-…\|3-…/);
    expect(validateCsrInput({ ...INPUT, invoiceTypes: "0000" })[0]).toMatch(/TSCZ/);
    expect(validateCsrInput({ ...INPUT, commonName: "x".repeat(65) })[0]).toMatch(/longer than 64/);
    // VAT group (11th digit 1): OU must be the member's 10-digit TIN
    expect(validateCsrInput({ ...INPUT, vatNumber: "399999999910003" })[0]).toMatch(/TIN/);
    expect(validateCsrInput({ ...INPUT, vatNumber: "399999999910003", organizationUnit: "1234567890" })).toEqual([]);
    expect(() => buildEgsCsr({ ...INPUT, vatNumber: "1" }, generateEgsKeyPair().privateKey)).toThrow(CsrInputError);
  });
});
