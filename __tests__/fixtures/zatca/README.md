# ZATCA fixtures

- `sdk-simplified-invoice.xml` — `Data/Samples/Simplified/Invoice/Simplified_Invoice.xml` of ZATCA's
  E-invoicing SDK (Compliance and Enablement Toolbox), as mirrored in
  https://github.com/mrsool/zatca/tree/main/einvoicing-sdk (raw file fetched 2026-11-06,
  sha256 `8e0b266522339002d546b2a5ca2c212dd472721295ef5765187758e8f05e1f92`). It is a signed sample
  with its own invoice hash (`DigestValue` of `invoiceSignedData`), SignedProperties digest,
  ECDSA signature, certificate and Phase-2 QR — the official vectors `__tests__/zatca/canonical-hash.test.ts`
  reproduces with lib/zatca (see data/research/zatca-phase2.md).
