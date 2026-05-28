/**
 * ZATCA cryptographic helpers.
 *
 * ZATCA mandates ECDSA over the `secp256k1` curve (yes, the Bitcoin curve) and SHA-256 hashing
 * for invoice signing. The CSR (Certificate Signing Request) follows a specific subject DN
 * pattern with OIDs for VAT number, organization unit, etc.
 *
 * Production note: generating CSRs is best done with `node-forge` or `pkijs`; this file
 * provides the structural template and signing primitive. Wire to your preferred crypto lib.
 */
import { createSign, createPrivateKey } from "crypto";

export type ZatcaSubject = {
  commonName: string;       // e.g., "TST-886431145-399999999900003"
  organizationName: string; // legal seller name
  organizationalUnit: string;
  countryName: "SA";
  serialNumber: string;     // e.g., "1-MyCompany|2-MyDevice|3-uuid"
  vatNumber: string;        // 15 digits
  invoiceType: string;      // "1100" → standard + simplified
  registeredAddress: string;
  businessCategory: string;
};

/** Build the CSR config (subject + extensions) per ZATCA template. */
export function buildCSRConfig(subject: ZatcaSubject) {
  return {
    subject: [
      { type: "commonName", value: subject.commonName },
      { type: "organizationName", value: subject.organizationName },
      { type: "organizationalUnitName", value: subject.organizationalUnit },
      { type: "countryName", value: subject.countryName }
    ],
    extensions: [
      {
        name: "subjectAltName",
        altNames: [
          { type: 4 /* DirectoryName */, value: buildDirectoryName(subject) }
        ]
      }
    ]
  };
}

function buildDirectoryName(subject: ZatcaSubject): string {
  return [
    `SN=${subject.serialNumber}`,
    `UID=${subject.vatNumber}`,
    `T=${subject.invoiceType}`,
    `CATEGORY=${subject.businessCategory}`,
    `ADDR=${subject.registeredAddress}`
  ].join(",");
}

/**
 * Sign the invoice hash with the merchant's private key (PEM).
 * ZATCA UBL extensions expect a Base64-encoded ECDSA signature over the canonical XML hash.
 */
export function signInvoiceHash(invoiceHashBase64: string, privateKeyPEM: string): string {
  const signer = createSign("sha256");
  signer.update(Buffer.from(invoiceHashBase64, "base64"));
  signer.end();
  const key = createPrivateKey(privateKeyPEM);
  return signer.sign(key).toString("base64");
}
