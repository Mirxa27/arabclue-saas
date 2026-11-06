/**
 * critic-15 — the keyboard inset calculation and the "is this a text field" check behind the
 * keyboard-aware bottom UI, as pure functions. The acceptance boundary is still QA on real
 * iOS Safari / Android Chrome; these pin the arithmetic and the edge cases.
 */
import { describe, expect, it } from "vitest";
import { computeKeyboardInset, isTextEntryElement } from "@/lib/hooks/viewport";

describe("computeKeyboardInset", () => {
  it("is the part of the layout viewport below the visual viewport (iOS keyboard up)", () => {
    // iPhone 13: 664px layout viewport, keyboard leaves 336px visible.
    expect(computeKeyboardInset(664, { height: 336, offsetTop: 0, scale: 1 })).toBe(328);
  });

  it("accounts for Safari scrolling the visual viewport to reveal the focused field", () => {
    // visible band is layout y 100…428 → 236px hidden below it
    expect(computeKeyboardInset(664, { height: 328, offsetTop: 100, scale: 1 })).toBe(236);
  });

  it("is 0 when there is no keyboard (visual viewport == layout viewport)", () => {
    expect(computeKeyboardInset(667, { height: 667, offsetTop: 0, scale: 1 })).toBe(0);
  });

  it("is 0 on Chromium with interactive-widget=resizes-content (both viewports shrink together)", () => {
    expect(computeKeyboardInset(400, { height: 400, offsetTop: 0, scale: 1 })).toBe(0);
  });

  it("ignores sub-pixel noise and never goes negative", () => {
    expect(computeKeyboardInset(667, { height: 666.6, offsetTop: 0, scale: 1 })).toBe(0);
    expect(computeKeyboardInset(667, { height: 700, offsetTop: 0, scale: 1 })).toBe(0);
  });

  it("is 0 while the page is pinch-zoomed (a smaller visual viewport is not a keyboard)", () => {
    expect(computeKeyboardInset(667, { height: 333.5, offsetTop: 0, scale: 2 })).toBe(0);
  });

  it("is 0 without a visual viewport or with nonsense input", () => {
    expect(computeKeyboardInset(667, null)).toBe(0);
    expect(computeKeyboardInset(667, undefined)).toBe(0);
    expect(computeKeyboardInset(0, { height: 300, offsetTop: 0, scale: 1 })).toBe(0);
    expect(computeKeyboardInset(Number.NaN, { height: 300, offsetTop: 0, scale: 1 })).toBe(0);
    expect(computeKeyboardInset(667, { height: Number.NaN, offsetTop: 0, scale: 1 })).toBe(0);
  });

  it("never exceeds the layout height", () => {
    expect(computeKeyboardInset(500, { height: 0, offsetTop: -50, scale: 1 })).toBe(500);
  });
});

describe("isTextEntryElement", () => {
  it("accepts text-like inputs, textareas and contenteditable", () => {
    for (const type of ["text", "email", "search", "tel", "url", "password", "number", "date", "datetime-local"]) {
      expect(isTextEntryElement({ tagName: "INPUT", type }), type).toBe(true);
    }
    expect(isTextEntryElement({ tagName: "input" })).toBe(true); // no type → text
    expect(isTextEntryElement({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextEntryElement({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("rejects controls that do not open a keyboard", () => {
    for (const type of ["checkbox", "radio", "range", "file", "color", "button", "submit", "reset", "image", "hidden"]) {
      expect(isTextEntryElement({ tagName: "INPUT", type }), type).toBe(false);
    }
    expect(isTextEntryElement({ tagName: "SELECT" })).toBe(false);
    expect(isTextEntryElement({ tagName: "BUTTON" })).toBe(false);
    expect(isTextEntryElement({ tagName: "BODY" })).toBe(false);
    expect(isTextEntryElement(null)).toBe(false);
  });

  it("rejects read-only and disabled fields", () => {
    expect(isTextEntryElement({ tagName: "INPUT", type: "text", readOnly: true })).toBe(false);
    expect(isTextEntryElement({ tagName: "TEXTAREA", disabled: true })).toBe(false);
  });
});
