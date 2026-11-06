/**
 * EGS (E-invoice Generation Solution) key pair + PKCS#10 certificate signing request for ZATCA
 * onboarding (Fatoora POST /compliance).
 *
 * Ground truth (data/research/zatca-phase2.md §CSR):
 *  - ECDSA on secp256k1, SHA-256 (Security Features Implementation Standards v1.2 §2.2.1 #16;
 *    E-invoicing Detailed Technical Guideline §5 "openssl ecparam -name secp256k1 -genkey").
 *  - Subject C=SA, OU=<branch>, O=<taxpayer name>, CN=<unit name> and a subjectAltName dirName with
 *    SN (surname 2.5.4.4: "1-…|2-…|3-…" EGS serial), UID (0.9.2342.19200300.100.1.1: VAT number),
 *    title (2.5.4.12: "TSCZ" functionality map), registeredAddress (2.5.4.26) and
 *    businessCategory (2.5.4.15) — the OpenSSL configuration in ZATCA's Developer Portal manual
 *    §5.3.1, plus the certificate template name extension (1.3.6.1.4.1.311.20.2) as a
 *    PrintableString: TSTZATCA-Code-Signing (developer portal), PREZATCA-Code-Signing (simulation),
 *    ZATCA-Code-Signing (production).
 *  - The CSR is self-signed with the EGS private key (proof of possession, Security standard #7).
 *
 * The private key never leaves the server: callers store it encrypted (lib/zatca/egs-store.ts).
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from "crypto";
import { bitString, boolean, contextConstructed, integer, octetString, oid, PRINTABLE, printableString, sequence, setOf, utf8String } from "@/lib/zatca/der";
import type { ZatcaEnvironment } from "@/lib/zatca/config";

export const CERTIFICATE_TEMPLATE_NAMES: Record<ZatcaEnvironment, string> = {
  sandbox: "TSTZATCA-Code-Signing",
  simulation: "PREZATCA-Code-Signing",
  production: "ZATCA-Code-Signing"
};

export const OIDS = {
  ecPublicKey: "1.2.840.10045.2.1",
  secp256k1: "1.3.132.0.10",
  ecdsaWithSha256: "1.2.840.10045.4.3.2",
  extensionRequest: "1.2.840.113549.1.9.14",
  subjectAltName: "2.5.29.17",
  certificateTemplateName: "1.3.6.1.4.1.311.20.2",
  countryName: "2.5.4.6",
  organizationName: "2.5.4.10",
  organizationalUnitName: "2.5.4.11",
  commonName: "2.5.4.3",
  surname: "2.5.4.4",
  userId: "0.9.2342.19200300.100.1.1",
  title: "2.5.4.12",
  registeredAddress: "2.5.4.26",
  businessCategory: "2.5.4.15"
} as const;

export type EgsCsrInput = {
  environment: ZatcaEnvironment;
  /** CN — unique name / asset tracking number of the solution unit. */
  commonName: string;
  /** O — the taxpayer's name. */
  organizationName: string;
  /** OU — branch name; for VAT-group members (11th VAT digit = 1) the member's 10-digit TIN. */
  organizationUnit: string;
  /** SN — "1-<solution provider>|2-<model or version>|3-<serial number>". */
  egsSerialNumber: string;
  /** UID — 15-digit VAT registration number, first and last digit 3. */
  vatNumber: string;
  /** title — "TSCZ" functionality map: 1000 standard only, 0100 simplified only, 1100 both. */
  invoiceTypes: string;
  /** registeredAddress — branch location (short national address, or the store URL). */
  location: string;
  /** businessCategory — industry. */
  industry: string;
};

export const VAT_NUMBER_RE = /^3\d{13}3$/;
export const EGS_SERIAL_RE = /^1-[^|]+\|2-[^|]+\|3-[^|]+$/;
const MAX_DN_FIELD = 64; // X.520 upper bound for CN / O / OU (OpenSSL enforces it too)

/** Problems with the CSR inputs (empty = valid). Messages are for logs/tests; the UI maps codes. */
export function validateCsrInput(input: EgsCsrInput): string[] {
  const errors: string[] = [];
  const nonEmpty = (name: string, value: string, max = 256) => {
    if (!value || !value.trim()) errors.push(`${name} is required`);
    else if ([...value].length > max) errors.push(`${name} is longer than ${max} characters`);
  };
  nonEmpty("commonName", input.commonName, MAX_DN_FIELD);
  nonEmpty("organizationName", input.organizationName, MAX_DN_FIELD);
  nonEmpty("organizationUnit", input.organizationUnit, MAX_DN_FIELD);
  nonEmpty("location", input.location);
  nonEmpty("industry", input.industry);
  if (!VAT_NUMBER_RE.test(input.vatNumber)) errors.push("vatNumber must be 15 digits starting and ending with 3");
  if (!EGS_SERIAL_RE.test(input.egsSerialNumber)) errors.push("egsSerialNumber must look like 1-…|2-…|3-…");
  if (!/^[01]{4}$/.test(input.invoiceTypes) || input.invoiceTypes === "0000") {
    errors.push("invoiceTypes must be four 0/1 digits (TSCZ), not all 0");
  }
  if (input.vatNumber[10] === "1" && !/^\d{10}$/.test(input.organizationUnit)) {
    errors.push("organizationUnit must be the member's 10-digit TIN for a VAT group number");
  }
  if (!CERTIFICATE_TEMPLATE_NAMES[input.environment]) errors.push("unknown environment");
  return errors;
}

export class CsrInputError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid ZATCA CSR input: ${problems.join("; ")}`);
    this.name = "CsrInputError";
  }
}

export type EgsKeyPair = { privateKey: KeyObject; privateKeyPem: string; publicKeySpki: Buffer };

/** A fresh secp256k1 key pair (PKCS#8 PEM for storage, SPKI DER for the CSR/QR). */
export function generateEgsKeyPair(): EgsKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  return {
    privateKey,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeySpki: publicKey.export({ type: "spki", format: "der" })
  };
}

/** Load a stored private key (PKCS#8 or SEC1 PEM) and check it is a secp256k1 EC key. */
export function loadEgsPrivateKey(pem: string): KeyObject {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "secp256k1") {
    throw new Error("ZATCA EGS key must be an EC secp256k1 private key");
  }
  return key;
}

function attribute(type: string, value: Buffer): Buffer {
  // RelativeDistinguishedName ::= SET OF AttributeTypeAndValue — one attribute per RDN, like OpenSSL.
  return setOf(sequence(oid(type), value));
}

function stringValue(value: string): Buffer {
  return utf8String(value);
}

function subjectName(input: EgsCsrInput): Buffer {
  return sequence(
    attribute(OIDS.countryName, printableString("SA")),
    attribute(OIDS.organizationalUnitName, stringValue(input.organizationUnit)),
    attribute(OIDS.organizationName, stringValue(input.organizationName)),
    attribute(OIDS.commonName, stringValue(input.commonName))
  );
}

function egsDirectoryName(input: EgsCsrInput): Buffer {
  return sequence(
    attribute(OIDS.surname, stringValue(input.egsSerialNumber)),
    attribute(OIDS.userId, stringValue(input.vatNumber)),
    attribute(OIDS.title, stringValue(input.invoiceTypes)),
    attribute(OIDS.registeredAddress, stringValue(input.location)),
    attribute(OIDS.businessCategory, stringValue(input.industry))
  );
}

function extension(id: string, value: Buffer, critical = false): Buffer {
  return critical ? sequence(oid(id), boolean(true), octetString(value)) : sequence(oid(id), octetString(value));
}

export type BuiltCsr = { der: Buffer; pem: string; /** base64(PEM) — the `csr` field Fatoora expects. */ base64Pem: string };

export function buildEgsCsr(input: EgsCsrInput, privateKey: KeyObject): BuiltCsr {
  const problems = validateCsrInput(input);
  if (problems.length) throw new CsrInputError(problems);
  const template = CERTIFICATE_TEMPLATE_NAMES[input.environment];
  if (!PRINTABLE.test(template)) throw new Error("certificate template name must be printable");

  const spki = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const extensions = sequence(
    extension(OIDS.certificateTemplateName, printableString(template)),
    // GeneralNames ::= SEQUENCE OF GeneralName; directoryName [4] Name (EXPLICIT: Name is a CHOICE)
    extension(OIDS.subjectAltName, sequence(contextConstructed(4, egsDirectoryName(input))))
  );
  const attributes = contextConstructed(0, sequence(oid(OIDS.extensionRequest), setOf(extensions)));
  const certificationRequestInfo = sequence(integer(0), subjectName(input), spki, attributes);

  const signature = sign("sha256", certificationRequestInfo, privateKey); // DER Ecdsa-Sig-Value
  const der = sequence(certificationRequestInfo, sequence(oid(OIDS.ecdsaWithSha256)), bitString(signature));
  const pem = toPem("CERTIFICATE REQUEST", der);
  return { der, pem, base64Pem: Buffer.from(pem, "utf8").toString("base64") };
}

export function toPem(label: string, der: Buffer): string {
  const body = der.toString("base64").match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}
