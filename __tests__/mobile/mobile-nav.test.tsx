// @vitest-environment jsdom
/**
 * MNAV-01 / MORESHEET-01 / TOUCH-01 / critic-15 — the bottom tab bar and its More sheet.
 * jsdom has no layout engine, so this asserts the attributes and classes that make the closed
 * sheet unreachable (inert, aria-hidden, no dialog role, translated below the viewport,
 * invisible, no pointer events) plus focus handling; scripts/mobile-check.mjs measures the
 * real hit-tests in Chromium.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

let pathname = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, ...rest }: { href: string; children: ReactNode; prefetch?: boolean }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { MobileNav, MORE_SHEET_ID } from "@/components/dashboard/mobile-nav";

function sheet(): HTMLElement {
  const el = document.getElementById(MORE_SHEET_ID);
  if (!el) throw new Error("sheet not rendered");
  return el;
}

const moreButton = () => screen.getByRole("button", { name: "More navigation options" });

beforeEach(() => {
  pathname = "/dashboard";
  document.body.style.overflow = "";
});

afterEach(() => cleanup());

describe("MobileNav — closed More sheet (MNAV-01)", () => {
  it("is inert, hidden from assistive tech and not a dialog while closed", () => {
    render(<MobileNav />);
    const el = sheet();
    expect(el.hasAttribute("inert")).toBe(true);
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.getAttribute("role")).toBeNull();
    expect(el.getAttribute("aria-modal")).toBeNull();
    expect(el.dataset.state).toBe("closed");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is translated fully below the viewport (own height + the tab bar), invisible and click-through", () => {
    render(<MobileNav />);
    const cls = sheet().className.split(/\s+/);
    expect(cls).toContain("translate-y-[calc(100%+4.75rem+var(--safe-bottom))]");
    expect(cls).toContain("invisible");
    expect(cls).toContain("pointer-events-none");
    // visibility flips only after the slide on close…
    expect(sheet().className).toContain("visibility_0s_linear_300ms");
    // …and the old "translate-y-full" (which parked the sheet exactly over the tabs) is gone.
    expect(cls).not.toContain("translate-y-full");
  });

  it("keeps every tab link outside the sheet and marks the active one", () => {
    pathname = "/social";
    render(<MobileNav />);
    const nav = screen.getByRole("navigation", { name: "Primary mobile navigation" });
    for (const name of ["Overview", "Social", "Voice", "SEO"]) {
      const link = screen.getAllByText(name)[0].closest("a")!;
      expect(nav.contains(link)).toBe(true);
      expect(sheet().contains(link)).toBe(false);
    }
    expect(screen.getAllByText("Social")[0].closest("a")!.getAttribute("aria-current")).toBe("page");
  });
});

describe("MobileNav — open More sheet", () => {
  it("becomes a visible modal dialog, focuses the 44px close button and locks page scroll", () => {
    render(<MobileNav />);
    fireEvent.click(moreButton());

    const dialog = screen.getByRole("dialog", { name: "More navigation" });
    expect(dialog.id).toBe(MORE_SHEET_ID);
    expect(dialog.hasAttribute("inert")).toBe(false);
    expect(dialog.getAttribute("aria-hidden")).toBeNull();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const cls = dialog.className.split(/\s+/);
    expect(cls).toContain("translate-y-0");
    expect(cls).toContain("visible");
    // visibility switches instantly on open (no delayed visibility transition)
    expect(dialog.className).not.toContain("visibility_0s");
    expect(moreButton().getAttribute("aria-expanded")).toBe("true");
    expect(moreButton().getAttribute("aria-controls")).toBe(MORE_SHEET_ID);

    const close = screen.getByRole("button", { name: "Close menu" });
    expect(document.activeElement).toBe(close);
    expect(close.className).toContain("h-11");
    expect(close.className).toContain("w-11");
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("is bounded by the dynamic viewport with a shrinking, scrollable grid (MORESHEET-01)", () => {
    render(<MobileNav />);
    const cls = sheet().className;
    expect(cls).toContain("flex-col");
    expect(cls).toContain("max-h-[calc(100dvh-4.75rem-var(--safe-bottom)-max(0.5rem,var(--safe-top)))]");
    expect(cls).not.toContain("max-h-[70vh]");
    const grid = sheet().querySelector(".grid") as HTMLElement;
    expect(grid.className).toContain("min-h-0");
    expect(grid.className).toContain("flex-1");
    expect(grid.className).toContain("overflow-y-auto");
    expect(grid.className).not.toContain("max-h-[50vh]");
  });

  it("closes on Escape and returns focus to the More button", () => {
    render(<MobileNav />);
    fireEvent.click(moreButton());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(sheet().hasAttribute("inert")).toBe(true);
    expect(sheet().getAttribute("role")).toBeNull();
    expect(document.activeElement).toBe(moreButton());
    expect(document.body.style.overflow).toBe("");
  });

  it("returns focus to the More button after closing with the X", () => {
    render(<MobileNav />);
    fireEvent.click(moreButton());
    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(sheet().dataset.state).toBe("closed");
    expect(document.activeElement).toBe(moreButton());
  });

  it("keeps the drag handle out of the tab order and out of the accessibility tree (TOUCH-01)", () => {
    render(<MobileNav />);
    fireEvent.click(moreButton());
    const handle = sheet().querySelector('button[tabindex="-1"]') as HTMLButtonElement;
    expect(handle).not.toBeNull();
    expect(handle.getAttribute("aria-hidden")).toBe("true");
    expect(handle.className).toContain("h-6");
  });

  it("does not close when the module grid is scrolled with a downward finger move", () => {
    render(<MobileNav />);
    fireEvent.click(moreButton());
    const grid = sheet().querySelector(".grid") as HTMLElement;
    fireEvent.touchStart(grid, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(grid, { touches: [{ clientY: 300 }] });
    expect(sheet().dataset.state).toBe("open");
  });

  it("closes on a downward swipe that starts on the handle/header", () => {
    render(<MobileNav />);
    fireEvent.click(moreButton());
    const header = screen.getByText("All modules");
    fireEvent.touchStart(header, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(header, { touches: [{ clientY: 200 }] });
    expect(sheet().dataset.state).toBe("closed");
  });

  it("closes when the route changes", () => {
    const { rerender } = render(<MobileNav />);
    fireEvent.click(moreButton());
    pathname = "/invoices";
    act(() => rerender(<MobileNav />));
    expect(sheet().dataset.state).toBe("closed");
  });
});

describe("MobileNav — hidden while typing (critic-15)", () => {
  it("slides the tab bar away, inert and aria-hidden", () => {
    render(<MobileNav hidden />);
    const nav = document.querySelector("nav")!;
    expect(nav.hasAttribute("inert")).toBe(true);
    expect(nav.getAttribute("aria-hidden")).toBe("true");
    const cls = nav.className.split(/\s+/);
    expect(cls).toContain("translate-y-full");
    expect(cls).toContain("invisible");
    expect(cls).toContain("pointer-events-none");
  });

  it("is visible and interactive otherwise, with a real (opacity-modified) background", () => {
    render(<MobileNav />);
    const nav = document.querySelector("nav")!;
    expect(nav.hasAttribute("inert")).toBe(false);
    expect(nav.getAttribute("aria-hidden")).toBeNull();
    expect(nav.className).toContain("bg-paper/78");
    // side safe areas (SAFEAREA-01)
    expect(nav.className).toContain("pl-[max(0.25rem,var(--safe-left))]");
    expect(nav.className).toContain("pr-[max(0.25rem,var(--safe-right))]");
  });
});
