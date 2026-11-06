import { validators } from "tailwind-merge";

/**
 * Font size the Input/Textarea primitives use when the caller sets none (ZOOM-01): 16px by
 * default, so no touch device zooms the page on focus, and the compact 14px only for a fine
 * (mouse/trackpad) pointer. The `(pointer: coarse)` rule in app/globals.css enforces 16px for
 * every other field as well; this keeps the primitives' intent explicit on their own.
 */
export const FIELD_TEXT_SIZE = "text-base [@media(pointer:fine)]:text-sm";

/** True when the token carries a variant prefix (`sm:`, `hover:`, `[@media(...)]:`). */
function hasVariant(token: string): boolean {
  let depth = 0;
  for (const ch of token) {
    if (ch === "[") depth += 1;
    else if (ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === ":" && depth === 0) return true;
  }
  return false;
}

/**
 * True when `className` sets an unconditional font size — `text-base`, `text-xs`, `!text-lg`,
 * `text-[13px]`, `text-[length:var(--x)]` — using tailwind-merge's own definition of the
 * font-size group, so it agrees with how `cn()` resolves conflicts. Colour utilities
 * (`text-ink`, `text-[#fff]`) and variant-scoped sizes (`sm:text-lg`) do not count.
 */
export function hasFontSizeClass(className: string | null | undefined): boolean {
  if (!className) return false;
  return className.split(/\s+/).some((raw) => {
    if (!raw || hasVariant(raw)) return false;
    const token = raw.startsWith("!") ? raw.slice(1) : raw;
    if (!token.startsWith("text-")) return false;
    const value = token.slice("text-".length);
    return value === "base" || validators.isTshirtSize(value) || validators.isArbitraryLength(value);
  });
}

/**
 * The default size classes, unless the caller already chose a size (the onboarding wizard
 * passes `text-base` and must stay 16px on desktop too).
 */
export function fieldTextSize(className: string | null | undefined): string | undefined {
  return hasFontSizeClass(className) ? undefined : FIELD_TEXT_SIZE;
}
