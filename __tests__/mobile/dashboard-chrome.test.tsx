// @vitest-environment jsdom
/**
 * STACK-01 (chrome side) / VH-01 / SAVEBAR-01 padding / FEEDBACK-01 coordination / critic-15:
 * the dashboard chrome's layout contract, rendered with the real tab bar and floating widgets.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next/navigation", () => ({ usePathname: () => "/settings" }));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, ...rest }: { href: string; children: ReactNode; prefetch?: boolean }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/dashboard/sidebar", () => ({ Sidebar: () => <aside data-testid="sidebar" /> }));
vi.mock("@/components/dashboard/dashboard-command-palette", () => ({ DashboardCommandPalette: () => null }));
vi.mock("@/components/dashboard/admin-access-denied", () => ({ AdminAccessDenied: () => null }));
vi.mock("@/components/dashboard/breadcrumbs", () => ({ Breadcrumbs: () => <nav aria-label="Breadcrumb" /> }));

import { DashboardChrome } from "@/components/dashboard/dashboard-chrome";

let coarse = true;

beforeEach(() => {
  coarse = true;
  window.localStorage.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(pointer: coarse)" ? coarse : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderChrome() {
  return render(
    <DashboardChrome>
      <label>
        VAT number
        <input type="text" />
      </label>
      <input type="checkbox" aria-label="Agree" />
    </DashboardChrome>,
  );
}

const shell = () => document.querySelector(".dashboard-shell") as HTMLElement;
const tabBar = () => screen.getByLabelText("Primary mobile navigation", { selector: "nav" });

describe("DashboardChrome layout", () => {
  it("gives <main> no z-index (no stacking context trapping page overlays) and dvh sizing", () => {
    renderChrome();
    const main = document.querySelector("main")!;
    const cls = main.className.split(/\s+/);
    expect(cls).toContain("relative");
    expect(cls.some((c) => /^z-/.test(c))).toBe(false);
    expect(cls).toContain("min-h-dvh");
    expect(cls).not.toContain("min-h-screen");
    expect(shell().className.split(/\s+/)).not.toContain("min-h-screen");
  });

  it("pads <main> on phones to clear the tab bar plus the floating launchers", () => {
    renderChrome();
    const cls = document.querySelector("main")!.className.split(/\s+/);
    expect(cls).toContain("pb-[calc(9rem+var(--safe-bottom))]");
    expect(cls).toContain("lg:pb-0");
  });

  it("docks the feedback and support launchers side by side above the bottom chrome", () => {
    renderChrome();
    const dock = screen.getByTestId("chrome-fab-dock");
    expect(dock.className).toContain("bottom-[calc(0.75rem+var(--chrome-bottom))]");
    expect(dock.className).toContain("z-50");
    expect(dock.contains(screen.getByRole("button", { name: /Share feedback/ }))).toBe(true);
    expect(dock.contains(screen.getByRole("button", { name: "Open support chat" }))).toBe(true);
  });

  it("hides the feedback widget while the support panel is open (FEEDBACK-01)", () => {
    renderChrome();
    fireEvent.click(screen.getByRole("button", { name: "Open support chat" }));
    expect(screen.getByRole("dialog", { name: "تواصل معنا" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Share feedback/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close support" }));
    expect(screen.getByRole("button", { name: /Share feedback/ })).toBeTruthy();
  });
});

describe("keyboard-aware chrome (critic-15)", () => {
  it("slides the tab bar and launchers away while a text field has focus on a touch device", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    renderChrome();
    expect(shell().dataset.textEntry).toBeUndefined();
    expect(tabBar().hasAttribute("inert")).toBe(false);

    const field = screen.getByLabelText("VAT number");
    act(() => field.focus());
    expect(shell().dataset.textEntry).toBe("true");
    expect(tabBar().hasAttribute("inert")).toBe(true);
    expect(screen.queryByRole("button", { name: "Open support chat" })).toBeNull();

    act(() => {
      field.blur();
      vi.runAllTimers();
    });
    expect(shell().dataset.textEntry).toBeUndefined();
    expect(tabBar().hasAttribute("inert")).toBe(false);
    expect(screen.getByRole("button", { name: "Open support chat" })).toBeTruthy();
  });

  it("does not react to checkboxes, nor to text fields on a mouse-driven device", () => {
    renderChrome();
    act(() => (screen.getByLabelText("Agree") as HTMLInputElement).focus());
    expect(shell().dataset.textEntry).toBeUndefined();
    cleanup();

    coarse = false;
    renderChrome();
    act(() => screen.getByLabelText("VAT number").focus());
    expect(shell().dataset.textEntry).toBeUndefined();
    expect(tabBar().hasAttribute("inert")).toBe(false);
  });
});
