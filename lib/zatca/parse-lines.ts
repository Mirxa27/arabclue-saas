/** Extract line items from ZATCA UBL XML for display. */
export type ParsedInvoiceLine = {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export function parseInvoiceLinesFromXml(xml: string): ParsedInvoiceLine[] {
  const lines: ParsedInvoiceLine[] = [];
  const blocks = xml.match(/<cac:InvoiceLine[\s\S]*?<\/cac:InvoiceLine>/g) ?? [];

  for (const block of blocks) {
    const name =
      block.match(/<cbc:Name[^>]*>([^<]*)<\/cbc:Name>/)?.[1]?.trim() ??
      block.match(/<cbc:Description[^>]*>([^<]*)<\/cbc:Description>/)?.[1]?.trim() ??
      "Item";
    const quantity = Number(block.match(/<cbc:InvoicedQuantity[^>]*>([^<]*)<\/cbc:InvoicedQuantity>/)?.[1] ?? 1);
    const unitPrice = Number(
      block.match(/<cbc:PriceAmount[^>]*>([^<]*)<\/cbc:PriceAmount>/)?.[1] ??
        block.match(/<cbc:LineExtensionAmount[^>]*>([^<]*)<\/cbc:LineExtensionAmount>/)?.[1] ??
        0
    );
    const lineTotal = Number(block.match(/<cbc:LineExtensionAmount[^>]*>([^<]*)<\/cbc:LineExtensionAmount>/)?.[1] ?? unitPrice * quantity);
    lines.push({ name, quantity, unitPrice, lineTotal });
  }

  return lines;
}
