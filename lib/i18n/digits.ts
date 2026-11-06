/**
 * Arabic keyboards and numeric pads can emit Arabic-Indic (U+0660–0669) or
 * Extended Arabic-Indic / Persian (U+06F0–06F9) digits. Normalise them to ASCII
 * before validating numeric identifiers (VAT, CR, postal code, building no.).
 */
export function toAsciiDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}
