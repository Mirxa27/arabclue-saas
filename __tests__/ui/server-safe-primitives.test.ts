/**
 * Server Components import "@/components/ui/primitives" (e.g. /invoices, /invoices/[id],
 * /marketplace, /marketplace/[slug]). A module without "use client" is evaluated in the React
 * Server Components layer, where createContext and hooks do not exist: a module-scope
 * React.createContext there made those pages 500 under `next dev` ("createContext only works in
 * Client Components") and only survived production builds because tree-shaking happened to drop
 * the unused code. Interactive primitives therefore live in components/ui/interactive.tsx
 * ("use client") and are re-exported from primitives.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as primitives from "@/components/ui/primitives";

const UI_DIR = path.join(process.cwd(), "components/ui");
const CLIENT_ONLY_API =
  /\b(?:React\.)?(?:createContext|useState|useEffect|useLayoutEffect|useReducer|useRef|useContext|useCallback|useMemo|useTransition|useDeferredValue|useImperativeHandle|useSyncExternalStore|useActionState|useOptimistic)\s*[<(]/;

const isClientModule = (source: string) => /^\s*["']use client["'];?/.test(source);

describe("components/ui modules that Server Components may import", () => {
  const files = readdirSync(UI_DIR).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));

  it("finds the ui modules", () => {
    expect(files).toEqual(expect.arrayContaining(["primitives.tsx", "interactive.tsx"]));
  });

  for (const file of files) {
    const source = readFileSync(path.join(UI_DIR, file), "utf8");
    if (isClientModule(source)) continue;
    it(`${file} (no "use client") calls no client-only React API`, () => {
      const offending = source
        .split("\n")
        .map((line, i) => ({ line: i + 1, text: line }))
        .filter(({ text }) => !text.trim().startsWith("//") && !text.trim().startsWith("*") && CLIENT_ONLY_API.test(text));
      expect(offending).toEqual([]);
    });
  }

  it("keeps the interactive primitives in a client module, re-exported from primitives", () => {
    const interactive = readFileSync(path.join(UI_DIR, "interactive.tsx"), "utf8");
    expect(isClientModule(interactive)).toBe(true);
    for (const name of ["Tabs", "Dropdown", "DropdownItem", "Tooltip", "Sheet"] as const) {
      expect(typeof (primitives as Record<string, unknown>)[name]).toBe("function");
    }
  });

  it("no longer exports the legacy toast (use components/ui/toast.tsx)", () => {
    expect("ToastProvider" in primitives).toBe(false);
    expect("useToast" in primitives).toBe(false);
  });
});
