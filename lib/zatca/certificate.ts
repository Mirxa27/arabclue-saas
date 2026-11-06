/**
 * The X.509 certificate ZATCA issues for an EGS unit (compliance or production CSID).
 *
 * Fatoora returns it as `binarySecurityToken` = Base64 of the certificate's Base64 DER text, and the
 * same token is the Basic-auth user name (Security Features standard §5). What signing needs from it
 * (Detailed Technical Guideline §5.2 steps 3–4, §6):
 *   - the Base64 DER text (ds:X509Certificate) and its "hash": Base64(hex(SHA-256(that text)))
 *   - issuer name and decimal serial number (xades:IssuerSerial)
 *   - the subject public key (QR tag 8) and the CA's signature over the certificate (QR tag 9)
 */
import { createHash, X509Certificate } from "crypto";
import { child, decodeDer, decodeOid, decodeString, decodeUnsignedInteger, TAG, type DerNode } from "@/lib/zatca/der";

export type EgsCertificate = {
  /** Base64 DER without PEM armour or line breaks — what goes into ds:X509Certificate. */
  base64: string;
  der: Buffer;
  pem: string;
  issuerName: string;
  serialNumber: string;
  subject: string;
  notBefore: Date;
  notAfter: Date;
  /** DER SubjectPublicKeyInfo. */
  publicKey: Buffer;
  /** The CA's DER ECDSA signature value (signatureValue BIT STRING without the unused-bits octet). */
  signature: Buffer;
};

const ATTRIBUTE_NAMES: Record<string, string> = {
  "2.5.4.3": "CN",
  "2.5.4.6": "C",
  "2.5.4.7": "L",
  "2.5.4.8": "ST",
  "2.5.4.10": "O",
  "2.5.4.11": "OU",
  "0.9.2342.19200300.100.1.25": "DC",
  "0.9.2342.19200300.100.1.1": "UID",
  "1.2.840.113549.1.9.1": "EMAILADDRESS",
  "2.5.4.5": "SERIALNUMBER"
};

/** RFC 2253-style escaping of a DN attribute value (as Java's X500Principal prints it). */
function escapeDnValue(value: string): string {
  let out = value.replace(/([\\,+"<>;=])/g, "\\$1");
  if (out.startsWith("#") || out.startsWith(" ")) out = `\\${out}`;
  if (out.endsWith(" ") && out.length > 1) out = `${out.slice(0, -1)}\\ `;
  return out;
}

/**
 * Issuer DN in the form ZATCA's own samples use for ds:X509IssuerName: most specific RDN first,
 * ", " separated — e.g. "CN=TSZEINVOICE-SubCA-1, DC=extgazt, DC=gov, DC=local".
 */
export function formatDistinguishedName(name: DerNode): string {
  const rdns = name.children.map((rdn) =>
    rdn.children
      .map((atv) => {
        const type = decodeOid(child(atv, 0, TAG.OID).content);
        const value = child(atv, 1);
        const label = ATTRIBUTE_NAMES[type] ?? `OID.${type}`;
        let text: string;
        try {
          text = decodeString(value);
        } catch {
          text = `#${value.raw.toString("hex")}`;
        }
        return `${label}=${escapeDnValue(text)}`;
      })
      .join("+")
  );
  return rdns.reverse().join(", ");
}

/** Base64(hex(SHA-256(base64 DER text))) — ZATCA's certificate digest (DTG §5.2 step 3). */
export function certificateHash(base64Der: string): string {
  return Buffer.from(createHash("sha256").update(base64Der, "utf8").digest("hex"), "utf8").toString("base64");
}

function normalizeBase64(value: string): string {
  return value.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
}

export function parseCertificate(base64OrPem: string): EgsCertificate {
  const base64 = normalizeBase64(base64OrPem);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error("certificate is not Base64");
  const der = Buffer.from(base64, "base64");
  const root = decodeDer(der);
  if (root.tag !== TAG.SEQUENCE || root.children.length !== 3) throw new Error("not an X.509 certificate");
  const tbs = child(root, 0, TAG.SEQUENCE);
  const signatureValue = child(root, 2, TAG.BIT_STRING);
  if (signatureValue.content[0] !== 0) throw new Error("certificate signature has unused bits");

  // TBSCertificate: [0] version, serialNumber, signature, issuer, validity, subject, spki, …
  const hasVersion = tbs.children[0]?.tag === 0xa0;
  const at = (i: number) => child(tbs, hasVersion ? i : i - 1);
  const serial = at(1);
  if (serial.tag !== TAG.INTEGER) throw new Error("certificate serial number missing");
  const issuer = at(3);
  const spki = at(6);
  if (spki.tag !== TAG.SEQUENCE) throw new Error("certificate public key missing");

  const pem = `-----BEGIN CERTIFICATE-----\n${base64.match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----\n`;
  const x509 = new X509Certificate(der);
  return {
    base64,
    der,
    pem,
    issuerName: formatDistinguishedName(issuer),
    serialNumber: decodeUnsignedInteger(serial.content).toString(10),
    subject: x509.subject.split("\n").reverse().join(", "),
    notBefore: new Date(x509.validFrom),
    notAfter: new Date(x509.validTo),
    publicKey: Buffer.from(spki.raw),
    signature: Buffer.from(signatureValue.content.subarray(1))
  };
}

/** Fatoora's binarySecurityToken (Base64 of the Base64 DER text) → certificate. */
export function certificateFromSecurityToken(binarySecurityToken: string): EgsCertificate {
  const inner = Buffer.from(binarySecurityToken.trim(), "base64").toString("utf8");
  return parseCertificate(inner);
}

/** HTTP Basic credential for Fatoora: base64("<binarySecurityToken>:<secret>"). */
export function basicCredential(binarySecurityToken: string, secret: string): string {
  return Buffer.from(`${binarySecurityToken}:${secret}`, "utf8").toString("base64");
}
