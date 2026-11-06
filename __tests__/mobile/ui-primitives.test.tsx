// @vitest-environment jsdom
/**
 * components/ui: TOUCH-01 (Button sizes), ZOOM-01 (Input/Textarea sizing), TOAST-01 (toast
 * placement), STACK-01 building blocks (Portal, Sheet, reference-counted scroll lock) and the
 * keyboard-inset writer behind --kb-inset (critic-15).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Sheet } from "@/components/ui/primitives";
import { Portal } from "@/components/ui/portal";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { ViewportInsets } from "@/components/ui/viewport-insets";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.style.overflow = "";
});

const classes = (el: Element) => el.className.split(/\s+/);

describe("Button touch targets (TOUCH-01)", () => {
  it("makes sm at least 44×44 on coarse pointers, also when squeezed with h-7 w-7", () => {
    render(
      <Button size="sm" className="h-7 w-7 p-0">
        x
      </Button>,
    );
    const cls = classes(screen.getByRole("button"));
    expect(cls).toContain("[@media(pointer:coarse)]:min-h-11");
    expect(cls).toContain("[@media(pointer:coarse)]:min-w-11");
    expect(cls).toContain("h-7"); // desktop size kept
  });

  it("keeps an icon-only md button at 44px", () => {
    render(<Button aria-label="Send">→</Button>);
    expect(classes(screen.getByRole("button"))).toContain("min-h-11");
  });
});

describe("Input / Textarea font size (ZOOM-01)", () => {
  it("default to 16px with the compact size only for fine pointers", () => {
    render(
      <>
        <Input aria-label="a" />
        <Textarea aria-label="b" />
      </>,
    );
    for (const el of [screen.getByLabelText("a"), screen.getByLabelText("b")]) {
      const cls = classes(el);
      expect(cls).toContain("text-base");
      expect(cls).toContain("[@media(pointer:fine)]:text-sm");
      expect(cls).not.toContain("text-sm");
    }
  });

  it("respect a caller's explicit size (the onboarding wizard's text-base)", () => {
    render(<Input aria-label="vat" className="rounded-xl text-base" />);
    const cls = classes(screen.getByLabelText("vat"));
    expect(cls).toContain("text-base");
    expect(cls).not.toContain("[@media(pointer:fine)]:text-sm");
  });
});

function ToastTrigger({ message, tone }: { message: string; tone?: "default" | "success" | "error" }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast(message, tone)}>
      fire
    </button>
  );
}

describe("Toasts (TOAST-01)", () => {
  it("span the width at the top inside the safe areas on phones and sit bottom-right from lg", () => {
    render(
      <ToastProvider>
        <ToastTrigger message="تم الحفظ" />
      </ToastProvider>,
    );
    const region = screen.getByTestId("toast-region");
    const cls = classes(region);
    expect(cls).toContain("top-[max(1rem,var(--safe-top))]");
    expect(cls).toContain("left-[max(1rem,var(--safe-left))]");
    expect(cls).toContain("right-[max(1rem,var(--safe-right))]");
    expect(cls).toContain("lg:bottom-4");
    expect(cls).toContain("lg:top-auto");
    expect(cls).toContain("z-[100]");
    // the undefined `mb-safe`, the overflowing full width and the md: switch are gone
    expect(cls).not.toContain("mb-safe");
    expect(cls).not.toContain("w-full");
    expect(cls.some((c) => c.startsWith("md:"))).toBe(false);
    expect(cls).not.toContain("bottom-20");
  });

  it("renders the message with dir=auto on the (now compiling) default tone", () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Saved ✓" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("fire"));
    const message = screen.getByText("Saved ✓");
    expect(message.getAttribute("dir")).toBe("auto");
    expect(message.parentElement!.className).toContain("bg-ink/85");
  });
});

describe("Portal + Sheet (overlay layer)", () => {
  it("Portal renders into document.body, outside the trapping container", () => {
    const { container } = render(
      <div className="dashboard-content-glass">
        <Portal>
          <div data-testid="overlay" />
        </Portal>
      </div>,
    );
    const overlay = screen.getByTestId("overlay");
    expect(container.contains(overlay)).toBe(false);
    expect(overlay.parentElement).toBe(document.body);
  });

  it("Sheet is portaled on z-[60]/z-[61], locks scroll, closes on Escape and restores focus", () => {
    const onClose = vi.fn();
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(
      <div className="dashboard-content-glass">
        <Sheet open onClose={onClose} title="Post">
          body
        </Sheet>
      </div>,
    );
    const dialog = screen.getByRole("dialog", { name: "Post" });
    expect(dialog.parentElement).toBe(document.body);
    expect(classes(dialog)).toContain("z-[61]");
    expect(document.querySelector(".z-\\[60\\]")).not.toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Close/ }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <div className="dashboard-content-glass">
        <Sheet open={false} onClose={onClose} title="Post">
          body
        </Sheet>
      </div>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

describe("useBodyScrollLock", () => {
  it("keeps the page locked until the last overlay releases, then restores the original value", () => {
    document.body.style.overflow = "clip";
    const a = renderHook(({ on }) => useBodyScrollLock(on), { initialProps: { on: true } });
    const b = renderHook(({ on }) => useBodyScrollLock(on), { initialProps: { on: true } });
    expect(document.body.style.overflow).toBe("hidden");
    a.rerender({ on: false });
    expect(document.body.style.overflow).toBe("hidden");
    b.unmount();
    expect(document.body.style.overflow).toBe("clip");
    a.unmount();
    expect(document.body.style.overflow).toBe("clip");
  });
});

describe("ViewportInsets (--kb-inset writer)", () => {
  let vv: EventTarget & { height: number; offsetTop: number; scale: number };

  beforeEach(() => {
    vv = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
    vi.stubGlobal("visualViewport", vv);
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  it("writes the keyboard inset to <html> as the visual viewport shrinks and clears it on unmount", () => {
    const { unmount } = render(<ViewportInsets />);
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--kb-inset")).toBe("");

    act(() => {
      vv.height = 460;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(root.style.getPropertyValue("--kb-inset")).toBe("340px");

    act(() => {
      vv.height = 800;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(root.style.getPropertyValue("--kb-inset")).toBe("0px");

    act(() => {
      vv.height = 500;
      vv.dispatchEvent(new Event("resize"));
    });
    unmount();
    expect(root.style.getPropertyValue("--kb-inset")).toBe("");
  });
});
