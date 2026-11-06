// @vitest-environment jsdom
/** PANEL-01 / TOUCH-01 / FEEDBACK-01 — the support launcher and panel. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SupportForm } from "@/components/dashboard/support-form";

const launcher = () => screen.queryByRole("button", { name: "Open support chat" });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SupportForm", () => {
  it("opens from the launcher into a viewport-bounded, internally scrolling panel (PANEL-01)", () => {
    render(<SupportForm />);
    fireEvent.click(launcher()!);
    const panel = screen.getByRole("dialog", { name: "تواصل معنا" });
    const cls = panel.className;
    expect(cls).toContain("max-h-[calc(100dvh-0.75rem-var(--chrome-bottom)-max(1rem,var(--safe-top)))]");
    expect(cls).toContain("overflow-y-auto");
    expect(cls).toContain("overscroll-contain");
    expect(cls).not.toContain("overflow-hidden");
    // sits above the tab bar / keyboard / home indicator and clear of the landscape notch
    expect(cls).toContain("bottom-[calc(0.75rem+var(--chrome-bottom))]");
    expect(cls).toContain("end-[calc(1.5rem+var(--chrome-side))]");
    // the header (with the close button) stays in view while the body scrolls
    const header = screen.getByText("تواصل معنا").closest("div.sticky");
    expect(header).not.toBeNull();
  });

  it("has a 44px close button that returns focus to the launcher; Escape closes too", () => {
    render(<SupportForm />);
    fireEvent.click(launcher()!);
    const close = screen.getByRole("button", { name: "Close support" });
    expect(close.className).toContain("h-11");
    expect(close.className).toContain("w-11");
    close.focus();
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(launcher());

    fireEvent.click(launcher()!);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("can be controlled by the chrome (so the feedback widget can hide while it is open)", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<SupportForm open={false} onOpenChange={onOpenChange} />);
    fireEvent.click(launcher()!);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole("dialog")).toBeNull(); // parent has not opened it yet

    rerender(<SupportForm open onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Close support" }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("hides only the launcher while typing elsewhere, never an open panel", () => {
    const { rerender } = render(<SupportForm open={false} launcherHidden />);
    expect(launcher()).toBeNull();
    rerender(<SupportForm open launcherHidden />);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("uses touch-sized, correctly hinted fields and the API's message bounds", () => {
    render(<SupportForm open />);
    const email = screen.getByLabelText(/البريد الإلكتروني/);
    expect(email.getAttribute("autocomplete")).toBe("email");
    expect(email.className).toContain("h-11");
    const message = screen.getByLabelText("الرسالة");
    expect(message.getAttribute("dir")).toBe("auto");
    expect(message.getAttribute("maxlength")).toBe("5000");

    const submit = screen.getByRole("button", { name: /إرسال/ });
    fireEvent.change(message, { target: { value: "abc" } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/At least 5 characters/)).toBeTruthy();
    fireEvent.change(message, { target: { value: "abcdef" } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("gives category options 44px rows", () => {
    render(<SupportForm open />);
    fireEvent.click(screen.getByRole("button", { name: /مساعدة عامة/ }));
    const option = screen.getByRole("button", { name: /اقتراح ميزة/ });
    expect(option.className).toContain("min-h-11");
  });
});
