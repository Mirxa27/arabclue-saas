# ZATCA Phase 2 (FATOORA integration) — the rules arabclue implements

Researched 2026-11-06 for the `zatca` stream (F14, F09, critic-24, UI-002/012/013/024). Every rule
below is either quoted from a ZATCA document, reproduced from ZATCA's own SDK sample, or observed on
ZATCA's developer-portal sandbox (marked **[sandbox]**). Code: `lib/zatca/*`, tests: `__tests__/zatca/*`.

## Sources

| # | Source | URL |
|---|---|---|
| S1 | Security Features Implementation Standards v1.2 (2023-05-19) | https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf |
| S2 | Electronic Invoice XML Implementation Standard v1.2 (2023-05-19) | https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_XML_Implementation_Standard_%20vF.pdf |
| S3 | E-invoicing Detailed Technical Guideline | https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-invoicing-Detailed-Technical-Guideline.pdf |
| S4 | Developer Portal User Manual | https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/DEVELOPER-PORTAL-MANUAL.pdf |
| S5 | SDK user manual (linked from ZATCA's SDK page https://zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/ComplianceEnablementToolbox/Pages/DownloadSDK.aspx) | https://mcusercontent.com/a90cefeb037ed376188308d34/files/2ca406b2-8627-66d9-45a4-94d186a4f3a5/User_Manual_Software_Development_Kit_SDK_.01.pdf |
| S6 | ZATCA SDK sample `Data/Samples/Simplified/Invoice/Simplified_Invoice.xml` (the SDK download itself is a SharePoint link this environment cannot reach; the file was taken from the public mirror of the SDK) | https://github.com/mrsool/zatca/blob/main/einvoicing-sdk/Data/Samples/Simplified/Invoice/Simplified_Invoice.xml — copy in `__tests__/fixtures/zatca/` |
| S7 | ZATCA developer-portal sandbox (Fatoora API V2) | https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal |

## Environments and API (S4 §2.3.10, §3; [sandbox])

| Environment | Base URL | CSR certificate template |
|---|---|---|
| `sandbox` (developer portal) | `https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal` | `TSTZATCA-Code-Signing` |
| `simulation` | `https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation` | `PREZATCA-Code-Signing` |
| `production` | `https://gw-fatoora.zatca.gov.sa/e-invoicing/core` | `ZATCA-Code-Signing` (S4 §5.3.1 screenshot) |

All three paths answer `400 {"errors":[{"code":"Missing-OTP"…}]}` to an OTP-less `/compliance`
call, an unknown path gets an Apigee routing fault **[sandbox, 2026-11-06]**.

Headers on every call: `Accept: application/json`, `Accept-Version: V2` (S4: "V2 is currently the
only valid version"), `Content-Type: application/json`, `Accept-Language: en`.
Auth: `Authorization: Basic base64(binarySecurityToken + ":" + secret)` (S1 §5, S4 §3).

| Call | Request | Answer **[sandbox]** |
|---|---|---|
| `POST /compliance` | header `OTP: <6 digits>`; body `{"csr": base64(CSR PEM text)}` | 200 `{requestID, dispositionMessage:"ISSUED", binarySecurityToken, secret, errors:null}`; wrong OTP 400 `{"errors":[{"code":"Invalid-OTP",…}]}`; missing OTP `Missing-OTP`; unreadable CSR 400 `Invalid Request` (text) |
| `POST /compliance/invoices` | compliance CSID; body `{invoiceHash, uuid, invoice: base64(XML)}` | 200 `{validationResults:{infoMessages,warningMessages,errorMessages,status:"PASS"}, reportingStatus|clearanceStatus}` |
| `POST /production/csids` | compliance CSID; body `{"compliance_request_id": "<requestID>"}` | 200 `{requestID, tokenType, dispositionMessage:"ISSUED", binarySecurityToken, secret}`; bad id 400 `{"code":"Incorrect-ComplianceRequestId"…}`; bad credential 401 (empty body) |
| `POST /invoices/reporting/single` | production CSID; simplified documents; `Clearance-Status: 0` | 200 `REPORTED`; 202 accepted with warnings; 400 `NOT_REPORTED` + `errorMessages`; re-reporting the same document answers 200 REPORTED again (safe retry) |
| `POST /invoices/clearance/single` | production CSID; standard documents; `Clearance-Status: 1` | 200 `CLEARED` + `clearedInvoice` (base64 of ZATCA's re-stamped XML); 400 `NOT_CLEARED`; 303 when clearance is switched off (S3 FAQ) → report instead |

Sandbox specifics: the documented OTP is `123345`; the compliance CSID certificate is issued for our
CSR (our public key, our subject/SAN, issuer `CN=eInvoicing`); the **production** CSID is ZATCA's
fixed test certificate (`CN=TST-886431145-399999999900003`, issuer `PRZEINVOICESCA4-CA`, not our
key), and reporting with it only accepts VAT `399999999900003` (`certificate-permissions` otherwise).
The sandbox checks the invoice hash strictly (`invalid-invoice-hash`) but neither the ECDSA
signature nor the SignedProperties digest — those are proven against S3/S6 instead (below). In
simulation/production arabclue refuses a production certificate that does not carry its own key.

## Onboarding flow (S3 §3, S4 §2.3.10)

compliance CSID (OTP) → compliance checks: one signed document per type the CSR declares (title
`1100` = standard + simplified → standard and simplified × invoice 388 / credit note 381 / debit note
383) → production CSID ("will return an invalid response until these compliance checks are completed",
S4 p.23). OTPs are single-use and valid for one hour (S3 §3.3.2), so every step's result is persisted
and a failed later step is resumed without a new OTP.

## CSR (S1 §2.2.2 Table 1, S4 §5.3.1 OpenSSL configuration)

- Key: ECDSA on `secp256k1`, signature `ecdsa-with-SHA256` (S1 §2.2.1 #16; S3 §5 "openssl ecparam -name secp256k1").
- Subject, one attribute per RDN: `C=SA` (PrintableString), `OU` (branch; for a VAT group — 11th VAT
  digit `1` — the member's 10-digit TIN), `O` (taxpayer name), `CN` (unit name) — UTF8String.
- Extensions (PKCS#9 extensionRequest):
  - `1.3.6.1.4.1.311.20.2` certificate template name = PrintableString per environment
    (S4: `certificateTemplateName = ASN1:PRINTABLESTRING:ZATCA-Code-Signing`);
  - `subjectAltName = dirName`: `SN` (OpenSSL's SN = surname 2.5.4.4) `1-<provider>|2-<model>|3-<serial>`,
    `UID` (0.9.2342.19200300.100.1.1) VAT number, `title` (2.5.4.12) functionality map `TSCZ`,
    `registeredAddress` (2.5.4.26) location, `businessCategory` (2.5.4.15) industry.
- arabclue: `CN=arabclue-<merchant id>`, `SN=1-arabclue|2-salla-v1|3-<merchant id>`, `title=1100`.
- Verified: byte-identical ASN.1 structure to `openssl req` with ZATCA's config; `openssl req -verify`
  OK (`__tests__/zatca/csr.test.ts`); **[sandbox]** issued a compliance certificate for it.

## Document (S2)

UBL 2.1 `Invoice`, element order of the UBL schema; `ProfileID reporting:1.0` (BR-KSA-EN16931-01);
`InvoiceTypeCode` 388/381/383 with `@name` `0100000` standard / `0200000` simplified (S2 §11.2.1,
BR-KSA-06); `DocumentCurrencyCode` and `TaxCurrencyCode` SAR (BR-KSA-68); ICV in
`AdditionalDocumentReference[ID=ICV]/UUID` (digits, BR-KSA-33/34); PIH in
`AdditionalDocumentReference[ID=PIH]/Attachment/EmbeddedDocumentBinaryObject` (BR-KSA-61) — the first
document's PIH is `NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==`,
Base64 of the hex SHA-256 of "0" (BR-KSA-26); `IssueTime` hh:mm:ss in AST (BR-KSA-70) — arabclue
prints date and time in Asia/Riyadh.
Seller: CRN `PartyIdentification` (BR-KSA-08), street, 4-digit building (BR-KSA-37), district
(BR-KSA-09), city, 5-digit postal code (BR-KSA-66), `CompanyID` VAT 3…3 (BR-KSA-39/40). Standard
documents: buyer name (BR-KSA-42), address (BR-KSA-10/63/67), VAT or other id (BR-KSA-14/44), supply
date (BR-KSA-15). Notes: `BillingReference` (BR-KSA-56), reason in `PaymentMeans/InstructionNote`
(BR-KSA-17). No empty elements (BR-KSA-F-03).
Amounts (S2 §9, §10): half-up; line net = round(qty × price) (BR-KSA-EN16931-11 — item prices may
carry more decimals; arabclue prints the shortest price reproducing the net); line VAT and
`RoundingAmount` = net + VAT (BR-KSA-51); VAT breakdown per category/rate, **rounded on the document
level**, not as a sum of rounded line VATs; two `TaxTotal` (one without subtotals, BR-KSA-EN16931-08/09).
0% lines need a category Z/E/O and an exemption reason code (BR-KSA-CL-04, BR-KSA-69/23/24) — Salla's
order payload carries neither, so such orders are not invoiced automatically.

## Signing (S1 §2.3.3, §3; S3 §5.2) — each rule reproduced from S6 / S3

1. **Invoice hash** = Base64(SHA-256(C14N 1.1 of the document without `ext:UBLExtensions`,
   `cac:Signature` and `cac:AdditionalDocumentReference[ID=QR]`)) — whitespace those blocks leave
   behind stays. Reproduces S6's `DigestValue` `r/2si60BEew0NQCHNHNejowLDLjVNV/VTT/P8QSLxMk=` with our
   parser + canonicalizer and with libxml2 (`xmllint --c14n11`); **[sandbox]** accepted our hashes
   (`invalid-invoice-hash` when tampered). Our documents are linearised, so the text we hash is the
   text ZATCA canonicalizes. The same hash is the next document's PIH (S1 §3).
2. **Signature value** = Base64(ECDSA-secp256k1 with SHA-256 over the **32 raw hash bytes**) —
   S3 step 2 "Generated Invoice Hash from Step 1 (not encode)"; verifies on S6 and on the S3 §6.2
   worked QR (tags 6/7/8); not over the Base64 text.
3. **Certificate digest** = Base64(hex(SHA-256(Base64 certificate text))) (S3 step 3; S6 `CertDigest`).
4. **SignedProperties**: `SigningTime`, `CertDigest` (SHA-256), `IssuerSerial` with
   `X509IssuerName` most-specific RDN first, `", "` separated (`CN=TSZEINVOICE-SubCA-1, DC=extgazt,
   DC=gov, DC=local`) and the decimal serial number (S6).
5. **SignedProperties digest** = Base64(hex(SHA-256(the element as it reads in the document — same
   whitespace, empty elements self-closed — with `xmlns:xades` on it and `xmlns:ds` on each `ds:*`
   element))) — reproduces S6 (`N2MxMGJkZWM4…`); S3 step 5 "get the properties tag … linearize". Our
   document writes that element linearised and with `<ds:DigestMethod …/>` self-closed, so the
   document text and the digested text are identical.
6. `ds:SignedInfo`: C14N 1.1, `ecdsa-sha256`, reference `invoiceSignedData` (URI "", the three XPath
   transforms + C14N 1.1, SHA-256) and the `#xadesSignedProperties` reference typed
   `http://www.w3.org/2000/09/xmldsig#SignatureProperties` (as in S6); `ext:ExtensionURI`
   `urn:oasis:names:specification:ubl:dsig:enveloped:xades`; `cac:Signature` IDs
   `urn:oasis:names:specification:ubl:signature:Invoice` / `…:dsig:enveloped:xades` (BR-KSA-28/29/30).
7. Standard documents are signed the same way; ZATCA re-stamps them on clearance and the returned
   `clearedInvoice` (with ZATCA's signature and QR) is stored as the legal document.

## QR (S1 §4.1 Table 3, S3 §6 incl. its hex example)

Base64 of TLV, tag and length one byte each (values ≤ 255 bytes): 1 seller name, 2 VAT number,
3 timestamp, 4 `TaxInclusiveAmount`, 5 `TaxTotal/TaxAmount` (BT-110), 6 invoice hash (its Base64
text), 7 signature (its Base64 text), 8 DER SubjectPublicKeyInfo, 9 (simplified documents) the CA's
DER signature over the certificate — all as in S6. Tag 3: S3 shows the SDK pattern
`yyyy-MM-dd'T'HH:mm:ss'Z'`, but **[sandbox]** answers `invoiceTimeStamp_QRCODE_INVALID` ("Time on QR
Code does not match with Invoice Issue Time (KSA-25)… use the latest version of SDK") when a `Z` is
appended to an AST `IssueTime`; arabclue writes `IssueDate + "T" + IssueTime` exactly (no warning).

## Chain, resubmission, retention (S3 §4.3, FAQ)

- One sequence per EGS for standard and simplified documents; the PIH is the hash of the last
  *generated* document, rejected ones included; an ICV is never reused.
- A rejected document is corrected and submitted as a NEW document (new ICV/UUID/PIH); the rejected
  record must not be changed. A document without a verdict (timeout, 5xx) is resent unchanged.
- arabclue: `zatca_append_invoice` allocates ICV + PIH atomically under a per-merchant head-row lock
  (`supabase/tests/45_zatca_chain.test.sql`, two sessions); one live invoice per Salla order
  (partial unique index; critic-24 remediation in `20261106003500_zatca_phase2.sql`).

## Sandbox transcript (2026-11-06, product code: `ZATCA_SANDBOX_E2E=1 npx vitest run __tests__/zatca/sandbox-e2e.test.ts`)

| Call | HTTP | Result |
|---|---|---|
| POST /compliance (OTP 123345, our CSR) | 200 | requestID 1234567890123, ISSUED |
| POST /compliance/invoices × 3 (standard invoice / credit / debit) | 200 | CLEARED, PASS, 0 errors, 0 warnings |
| POST /compliance/invoices × 3 (simplified invoice / credit / debit) | 200 | REPORTED, PASS, 0 errors, 0 warnings |
| POST /production/csids | 200 | requestID 30368, ISSUED |
| POST /invoices/reporting/single (Salla order → simplified invoice) | 200 | REPORTED, PASS, 0 errors, 0 warnings |
| POST /invoices/clearance/single (standard invoice) | 200 | CLEARED, PASS, 0 errors, 0 warnings; ZATCA-stamped XML returned |
