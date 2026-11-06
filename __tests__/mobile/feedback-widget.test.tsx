// @vitest-environment jsdom
/**
 * FEEDBACK-01 / UI-019 — the feedback card is never open by default, its X really dismisses it
 * (persisted for 30 days), the "thanks" state closes itself, and it yields to the support panel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FeedbackWidget, FEEDBACK_DONE_MS } from "@/components/dashboard/feedback-widget";
import { FEEDBACK_PROMPT_SNOOZE_MS, FEEDBACK_PROMPT_STORAGE_KEY } from "@/lib/ui/feedback-prompt";

const launcher = () => screen.queryByRole("button", { name: /Share feedback/ });

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("FeedbackWidget", () => {
  it("starts collapsed: a 44px launcher, no card over the page", () => {
    render(<FeedbackWidget />);
    expect(launcher()).not.toBeNull();
    expect(launcher()!.className).toContain("h-11");
    expect(launcher()!.className).toContain("w-11");
    expect(launcher()!.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("هل أعجبتك التجربة؟")).toBeNull();
  });

  it("opens the card from the launcher and collapses it again", () => {
    render(<FeedbackWidget />);
    fireEvent.click(launcher()!);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("هل أعجبتك التجربة؟")).toBeTruthy();
    expect(launcher()!.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(launcher()!);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(launcher()).not.toBeNull();
  });

  it("collapses on Escape", () => {
    render(<FeedbackWidget />);
    fireEvent.click(launcher()!);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(launcher());
  });

  it("dismisses for 30 days with the card's 44px X (the old X was a no-op)", () => {
    const now = Date.UTC(2026, 10, 6);
    vi.spyOn(Date, "now").mockReturnValue(now);
    render(<FeedbackWidget />);
    fireEvent.click(launcher()!);
    const close = screen.getByRole("button", { name: /Hide for 30 days/ });
    expect(close.className).toContain("h-11");
    expect(close.className).toContain("w-11");
    fireEvent.click(close);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(launcher()).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(FEEDBACK_PROMPT_STORAGE_KEY)!)).toEqual({
      hiddenAt: now,
      reason: "dismissed",
    });
  });

  it("stays hidden on the next visit within 30 days and returns afterwards", () => {
    const now = Date.UTC(2026, 10, 6);
    window.localStorage.setItem(FEEDBACK_PROMPT_STORAGE_KEY, JSON.stringify({ hiddenAt: now, reason: "dismissed" }));
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 1000);
    const first = render(<FeedbackWidget />);
    expect(launcher()).toBeNull();
    first.unmount();

    clock.mockReturnValue(now + FEEDBACK_PROMPT_SNOOZE_MS + 1);
    render(<FeedbackWidget />);
    expect(launcher()).not.toBeNull();
  });

  it("still renders (and dismisses without throwing) when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    render(<FeedbackWidget />);
    fireEvent.click(launcher()!);
    expect(() => fireEvent.click(screen.getByRole("button", { name: /Hide for 30 days/ }))).not.toThrow();
    expect(launcher()).toBeNull();
  });

  it("renders nothing while the support panel is open, and no launcher while typing", () => {
    const { rerender } = render(<FeedbackWidget hidden />);
    expect(launcher()).toBeNull();
    rerender(<FeedbackWidget launcherHidden />);
    expect(launcher()).toBeNull();
    rerender(<FeedbackWidget />);
    expect(launcher()).not.toBeNull();
  });

  it("thanks the user, then goes away by itself and stays away (no fall-back to the card)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<FeedbackWidget />);
    fireEvent.click(launcher()!);
    fireEvent.click(screen.getByText("نعم"));
    fireEvent.click(screen.getByText("سهل الاستخدام"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "إرسال" }));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ sentiment: "up", reasons: ["سهل الاستخدام"] });
    expect(screen.getByRole("status").textContent).toContain("شكراً لملاحظاتك");
    expect(JSON.parse(window.localStorage.getItem(FEEDBACK_PROMPT_STORAGE_KEY)!).reason).toBe("submitted");

    act(() => {
      vi.advanceTimersByTime(FEEDBACK_DONE_MS + 10);
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(launcher()).toBeNull();
  });

  it("shows a bilingual error in the step it was sent from when the API fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    render(<FeedbackWidget />);
    fireEvent.click(launcher()!);
    fireEvent.click(screen.getByText("لا"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "إرسال" }));
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("تعذّر إرسال ملاحظتك");
    expect(alert.textContent).toContain("please try again");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("bounds and directions the free-text note", () => {
    render(<FeedbackWidget />);
    fireEvent.click(launcher()!);
    fireEvent.click(screen.getByText("نعم"));
    fireEvent.click(screen.getByText("إضافة ملاحظة"));
    const note = screen.getByRole("textbox", { name: /Additional note/ });
    expect(note.getAttribute("maxlength")).toBe("2000");
    expect(note.getAttribute("dir")).toBe("auto");
  });
});
