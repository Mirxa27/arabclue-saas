/**
 * TWALPHA-01 / HOVER-01 — compile the repo's own Tailwind config and prove that every
 * opacity-modified colour utility used anywhere in app/, components/, lib/ and hooks/
 * (`bg-paper/78`, `border-rule/50`, `hover:bg-ink/[0.06]`, `bg-emerald-500/10` …) emits CSS.
 *
 * With theme colours as plain `var(--x)` strings Tailwind 3 silently dropped all of them (and
 * any alpha step missing from theme.opacity), leaving the tab bar, sheets and backdrops
 * transparent. A new class with an unsupported step (`bg-paper/73`) fails this test.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import config from "@/tailwind.config";

const ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["app", "components", "lib", "hooks"];

const COLOR_UTILITIES =
  "bg|text|border|border-[xytrblse]|ring|ring-offset|from|via|to|fill|stroke|shadow|outline|divide|placeholder|caret|accent|decoration";

/** `<utility>-<colour>/<alpha>` at the end of a class token (after any variants). */
const ALPHA_CLASS = new RegExp(
  `(?:^|:)!?-?(?:${COLOR_UTILITIES})-(?:[a-z]+(?:-[a-z]+)*(?:-\\d{2,3})?)\\/(?:\\d+(?:\\.\\d+)?|\\[[^\\]\\s]+\\])$`,
);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Every distinct opacity-modified colour class written in the scanned sources. */
function collectAlphaClasses(): Map<string, string> {
  const found = new Map<string, string>();
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of sourceFiles(abs)) {
      const src = fs.readFileSync(file, "utf8");
      // Class tokens are whitespace/quote delimited inside string literals.
      for (const token of src.split(/[\s"'`{}()<>,;]+/)) {
        if (!token.includes("/")) continue;
        if (ALPHA_CLASS.test(token) && !found.has(token)) found.set(token, path.relative(ROOT, file));
      }
    }
  }
  return found;
}

/** Unescape a CSS class selector the way Tailwind/cssesc escapes it. */
function unescapeCss(value: string): string {
  return value.replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/g, (_m, hex: string | undefined, ch: string | undefined) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : (ch as string),
  );
}

/** All class names appearing in the generated selectors. */
function classNamesIn(css: string): Set<string> {
  const names = new Set<string>();
  const root = postcss.parse(css);
  root.walkRules((rule) => {
    for (const match of rule.selector.matchAll(/\.((?:\\.|[^\s.:#>+~,[\]()\\])+)/g)) {
      names.add(unescapeCss(match[1]));
    }
  });
  return names;
}

async function compile(classes: string[]): Promise<string> {
  const result = await postcss([
    tailwindcss({ ...config, content: [{ raw: classes.join(" "), extension: "html" }] }),
  ]).process("@tailwind utilities;", { from: undefined });
  return result.css;
}

describe("Tailwind theme colours with opacity modifiers (TWALPHA-01)", () => {
  it("compiles every <colour>/<alpha> class used in the repo", async () => {
    const found = collectAlphaClasses();
    // Sanity: the scanner really sees the codebase (hundreds of these exist).
    expect(found.size).toBeGreaterThan(150);

    const classes = [...found.keys()];
    const emitted = classNamesIn(await compile(classes));
    const missing = classes.filter((cls) => !emitted.has(cls)).map((cls) => `${cls}  (${found.get(cls)})`);
    expect(missing, `these classes compile to no CSS:\n${missing.join("\n")}`).toEqual([]);
  }, 60_000);

  it("emits color-mix() at the modifier's alpha, from the theme variable", async () => {
    const css = await compile(["bg-paper/78", "bg-paper/88", "border-rule/50", "bg-accent/10", "bg-ink/[0.06]", "bg-ink/85"]);
    expect(css).toContain("background-color: color-mix(in srgb, var(--paper) calc(0.78 * 100%), transparent)");
    expect(css).toContain("background-color: color-mix(in srgb, var(--paper) calc(0.88 * 100%), transparent)");
    expect(css).toContain("border-color: color-mix(in srgb, var(--rule) calc(0.5 * 100%), transparent)");
    expect(css).toContain("background-color: color-mix(in srgb, var(--accent) calc(0.1 * 100%), transparent)");
    expect(css).toContain("background-color: color-mix(in srgb, var(--ink) calc(0.06 * 100%), transparent)");
    expect(css).toContain("background-color: color-mix(in srgb, var(--ink) calc(0.85 * 100%), transparent)");
  });

  it("keeps modifier-free classes opaque and opacity-variable driven", async () => {
    const css = await compile(["bg-paper", "text-ink", "bg-surface", "from-accent"]);
    expect(css).toContain("--tw-bg-opacity: 1");
    expect(css).toContain("color-mix(in srgb, var(--paper) calc(var(--tw-bg-opacity, 1) * 100%), transparent)");
    expect(css).toContain("color-mix(in srgb, var(--ink) calc(var(--tw-text-opacity, 1) * 100%), transparent)");
    expect(css).toContain("var(--surface-glass)");
    // gradient start at full strength, end transparent
    expect(css).toContain("--tw-gradient-from: color-mix(in srgb, var(--accent) calc(1 * 100%), transparent)");
  });

  it("covers every alpha step the codebase uses (incl. the non-default 6/8/12/42/62/68/78/86/88/98)", async () => {
    const steps = [6, 8, 12, 42, 62, 68, 78, 86, 88, 98];
    const classes = steps.map((s) => `bg-paper/${s}`);
    const emitted = classNamesIn(await compile(classes));
    for (const cls of classes) expect(emitted.has(cls), cls).toBe(true);
  });

  it("still drops an alpha step that is not in the scale (so the repo-wide check is meaningful)", async () => {
    const emitted = classNamesIn(await compile(["bg-paper/73"]));
    expect(emitted.has("bg-paper/73")).toBe(false);
  });
});

describe("hover only where hover exists (HOVER-01)", () => {
  it("wraps hover:, group-hover: and peer-hover: in (hover: hover) and (pointer: fine)", async () => {
    const css = await compile(["hover:bg-paper/40", "group-hover:inline-flex", "peer-hover:text-ink", "hover:-translate-y-0.5"]);
    const root = postcss.parse(css);
    const hoverRules: string[] = [];
    root.walkRules((rule) => {
      if (!rule.selector.includes(":hover")) return;
      const parent = rule.parent;
      expect(parent?.type).toBe("atrule");
      expect((parent as postcss.AtRule).params).toBe("(hover: hover) and (pointer: fine)");
      hoverRules.push(rule.selector);
    });
    expect(hoverRules).toHaveLength(4);
  });
});
