/**
 * Exact decimal arithmetic for invoice amounts (no binary floating point in what ZATCA checks).
 *
 * ZATCA rounds half-up (XML Implementation Standard v1.2 §10) on final results: line net amounts
 * and VAT breakdown tax amounts to two decimals. Item net prices may carry more decimals (no BR-DEC
 * rule limits BT-146), so a line whose net amount does not divide by its quantity is printed with
 * the shortest price that reproduces the net amount exactly.
 */

/** value = units / 10^scale */
export type Decimal = { readonly units: bigint; readonly scale: number };

const TEN = 10n;
const pow10 = (n: number) => TEN ** BigInt(n);

export function parseDecimal(input: string): Decimal {
  const s = input.trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`not a decimal number: ${JSON.stringify(input)}`);
  const frac = m[3] ?? "";
  const units = BigInt(`${m[2]}${frac}`) * (m[1] ? -1n : 1n);
  return { units, scale: frac.length };
}

/** A JS number as a decimal, via its shortest round-trip representation (no float noise added). */
export function decimalFromNumber(value: number): Decimal {
  if (!Number.isFinite(value)) throw new Error(`not a finite amount: ${value}`);
  const repr = String(value);
  if (/e/i.test(repr)) {
    // tiny or huge values: fall back to a fixed 12-decimal expansion
    return parseDecimal(value.toFixed(12));
  }
  return parseDecimal(repr);
}

function rescale(d: Decimal, scale: number): Decimal {
  if (scale === d.scale) return d;
  if (scale > d.scale) return { units: d.units * pow10(scale - d.scale), scale };
  return roundDecimal(d, scale);
}

/** Half-up rounding (half away from zero for negatives) to `scale` decimals. */
export function roundDecimal(d: Decimal, scale: number): Decimal {
  if (d.scale <= scale) return rescale(d, scale);
  const divisor = pow10(d.scale - scale);
  const negative = d.units < 0n;
  const abs = negative ? -d.units : d.units;
  let q = abs / divisor;
  const r = abs % divisor;
  if (r * 2n >= divisor) q += 1n;
  return { units: negative ? -q : q, scale };
}

export function addDecimal(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  return { units: rescale(a, scale).units + rescale(b, scale).units, scale };
}

export function subtractDecimal(a: Decimal, b: Decimal): Decimal {
  return addDecimal(a, { units: -b.units, scale: b.scale });
}

export function multiplyDecimal(a: Decimal, b: Decimal): Decimal {
  return { units: a.units * b.units, scale: a.scale + b.scale };
}

export function compareDecimal(a: Decimal, b: Decimal): number {
  const scale = Math.max(a.scale, b.scale);
  const x = rescale(a, scale).units;
  const y = rescale(b, scale).units;
  return x < y ? -1 : x > y ? 1 : 0;
}

export function decimalToString(d: Decimal, minScale = 0): string {
  let value = d;
  if (value.scale < minScale) value = rescale(value, minScale);
  const negative = value.units < 0n;
  const digits = (negative ? -value.units : value.units).toString().padStart(value.scale + 1, "0");
  const int = value.scale ? digits.slice(0, -value.scale) : digits;
  const frac = value.scale ? digits.slice(-value.scale) : "";
  return `${negative ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

export function decimalToNumber(d: Decimal): number {
  return Number(decimalToString(d));
}

/** Drop trailing fractional zeros down to `minScale`. */
export function trimDecimal(d: Decimal, minScale = 0): Decimal {
  let { units, scale } = d;
  while (scale > minScale && units % TEN === 0n) {
    units /= TEN;
    scale -= 1;
  }
  return { units, scale };
}

export const ZERO: Decimal = { units: 0n, scale: 2 };

/** Round a JS number half-up to two decimals, exactly (1.005 → 1.01). */
export function round2(value: number): number {
  return decimalToNumber(roundDecimal(decimalFromNumber(value), 2));
}

/** "123.40" — two decimals, half-up. */
export function formatAmount(value: number | Decimal): string {
  const d = typeof value === "number" ? decimalFromNumber(value) : value;
  return decimalToString(roundDecimal(d, 2), 2);
}

/** Quantities: integers as "3", otherwise up to six decimals ("0.5"). */
export function formatQuantity(value: number): string {
  if (!(value > 0)) throw new Error(`quantity must be positive: ${value}`);
  return decimalToString(trimDecimal(roundDecimal(decimalFromNumber(value), 6)));
}

/**
 * The shortest item net price (2–10 decimals) whose `quantity ×` product rounds half-up to
 * `lineNet` — i.e. what makes BR-KSA-EN16931-11 hold exactly. Throws when none exists.
 */
export function priceForLine(unitPrice: number, quantity: number, lineNet: Decimal): string {
  const qty = decimalFromNumber(Number(formatQuantity(quantity)));
  const exact = decimalFromNumber(unitPrice);
  for (let scale = 2; scale <= 10; scale++) {
    const candidate = trimDecimal(roundDecimal(exact, scale), 2);
    if (compareDecimal(roundDecimal(multiplyDecimal(candidate, qty), 2), lineNet) === 0) return decimalToString(candidate, 2);
  }
  throw new Error(`no item price reproduces line net ${decimalToString(lineNet, 2)} for quantity ${quantity}`);
}
