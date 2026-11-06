/**
 * Pure viewport helpers behind the keyboard-aware bottom UI (critic-15). No DOM globals are
 * read here, so they are unit-tested in node (__tests__/mobile/viewport.test.ts); the hooks in
 * hooks/use-keyboard-inset.ts and hooks/use-text-entry-focus.ts feed them live values.
 */

/** The subset of `window.visualViewport` the inset calculation needs. */
export type VisualViewportLike = {
  height: number;
  offsetTop: number;
  scale: number;
};

/**
 * Pixels at the bottom of the layout viewport hidden behind the on-screen keyboard.
 *
 * iOS Safari overlays the keyboard instead of resizing the layout viewport, so `position:fixed`
 * bottom UI ends up behind it; the visual viewport is what stays visible:
 *   inset = layoutHeight − visualViewport.height − visualViewport.offsetTop
 * (offsetTop is how far Safari scrolled the visual viewport to reveal the focused field).
 * Chromium with `interactive-widget=resizes-content` shrinks the layout viewport too, so the
 * inset there is 0 and nothing moves twice.
 *
 * Returns 0 when there is no visual viewport, while the page is pinch-zoomed (the visual
 * viewport is then smaller for reasons that have nothing to do with a keyboard) and for
 * sub-pixel rounding noise.
 */
export function computeKeyboardInset(layoutHeight: number, vv: VisualViewportLike | null | undefined): number {
  if (!vv || !Number.isFinite(layoutHeight) || layoutHeight <= 0) return 0;
  if (!Number.isFinite(vv.height) || !Number.isFinite(vv.offsetTop)) return 0;
  if (Number.isFinite(vv.scale) && Math.abs(vv.scale - 1) > 0.01) return 0;
  const inset = Math.round(layoutHeight - vv.height - vv.offsetTop);
  if (inset < 1) return 0;
  return Math.min(inset, Math.round(layoutHeight));
}

/** `<input type>` values that bring up a text keyboard (everything else is a button/picker). */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit"
]);

/** The parts of an Element the text-entry check reads (keeps the helper DOM-free). */
export type FocusTargetLike = {
  tagName: string;
  type?: string;
  readOnly?: boolean;
  disabled?: boolean;
  isContentEditable?: boolean;
};

/**
 * True when focusing `el` brings up the on-screen keyboard: an editable text-like `<input>`,
 * a `<textarea>` or a contenteditable element. Checkboxes, radios, buttons, `<select>` (a
 * picker, not a keyboard) and read-only/disabled fields are not text entry.
 */
export function isTextEntryElement(el: FocusTargetLike | null | undefined): boolean {
  if (!el || typeof el.tagName !== "string") return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA") return !el.readOnly && !el.disabled;
  if (tag !== "INPUT") return false;
  const type = (el.type ?? "text").toLowerCase();
  if (NON_TEXT_INPUT_TYPES.has(type)) return false;
  return !el.readOnly && !el.disabled;
}
