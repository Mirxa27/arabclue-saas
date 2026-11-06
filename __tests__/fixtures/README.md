# Provider payload fixtures

Copied from the providers' documentation so the zod schemas and mappings are tested against the
documented shapes, not hand-written probes (critic-2). Do not edit the JSON: if a provider changes
its documented sample, replace the file and note the new retrieval date here.

Retrieved 2026-11-06 via the Apidog markdown export (`<page>.md`) of docs.salla.dev.

| File | Source | Notes |
|---|---|---|
| `salla-order-created.json` | <https://docs.salla.dev/doc-433804> (same page: <https://docs.salla.dev/webhook-events/orders.md>), "Orders Webhook Events Model" → Example | verbatim |
| `salla-order-status-updated.json` | same page, "Order Status Updated Webhook Event Model" → Example | verbatim; `data.order` carries the order model |
| `salla-app-store-authorize.json` | <https://docs.salla.dev/doc-421413#app-store-authorize> | verbatim (Easy Mode token delivery) |
| `salla-app-uninstalled.json` | <https://docs.salla.dev/doc-421413#app-unistalled> | verbatim |
| `salla-invoice-created.json` | <https://docs.salla.dev/webhook-events/invoice.md> | verbatim (quantity 4, 15% VAT, discount) |
| `salla-user-info.json` | <https://docs.salla.dev/merchants/user-info.md> (`GET https://accounts.salla.sa/oauth2/user/info`) | the response `example`, transcribed from the OpenAPI YAML to JSON |
