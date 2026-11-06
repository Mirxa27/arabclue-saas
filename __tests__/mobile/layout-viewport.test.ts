/**
 * app/layout.tsx viewport (critic-15 / ZOOM-01 / SAFEAREA-01): keyboard resizes content on
 * Chromium, safe areas are active, and pinch-zoom is never disabled (iOS focus-zoom is handled
 * by the 16px coarse-pointer rule instead of maximum-scale).
 */
import { describe, expect, it } from "vitest";
import { viewport } from "@/app/layout";

describe("root viewport", () => {
  it("lets the on-screen keyboard resize the layout viewport (Chromium/Android)", () => {
    expect(viewport.interactiveWidget).toBe("resizes-content");
  });

  it("draws under the safe areas so env(safe-area-inset-*) is populated", () => {
    expect(viewport.viewportFit).toBe("cover");
    expect(viewport.width).toBe("device-width");
    expect(viewport.initialScale).toBe(1);
  });

  it("never caps or disables zoom", () => {
    expect(viewport.maximumScale).toBeUndefined();
    expect(viewport.userScalable).toBeUndefined();
  });
});
