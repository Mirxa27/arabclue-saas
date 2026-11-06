/**
 * app/globals.css invariants for touch devices:
 *  - ZOOM-01: a (pointer: coarse) rule renders text-entry controls at 16px (iOS focus-zoom),
 *    with a specificity that beats Tailwind's text-sm/text-xs utilities, and it survives the
 *    Tailwind build.
 *  - HOVER-01: every hand-written :hover rule is gated by (hover: hover) and (pointer: fine).
 *  - TOUCH-01: segmented filter buttons are 44px tall on coarse pointers.
 *  - critic-15 / SAFEAREA-01: keyboard / chrome inset variables and side safe-area padding.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import postcss, { type AtRule, type Container, type Rule } from "postcss";
import tailwindcss from "tailwindcss";
import config from "@/tailwind.config";

const CSS_PATH = path.resolve(__dirname, "../../app/globals.css");
const source = fs.readFileSync(CSS_PATH, "utf8");
const ast = postcss.parse(source);

function enclosingMedia(node: Rule): string[] {
  const params: string[] = [];
  let parent: Container | undefined = node.parent as Container | undefined;
  while (parent && parent.type !== "root") {
    if (parent.type === "atrule" && (parent as AtRule).name === "media") params.push((parent as AtRule).params);
    parent = parent.parent as Container | undefined;
  }
  return params;
}

function rulesMatching(predicate: (rule: Rule) => boolean): Rule[] {
  const out: Rule[] = [];
  ast.walkRules((rule) => {
    if (predicate(rule)) out.push(rule);
  });
  return out;
}

function decl(rule: Rule, prop: string): string | undefined {
  let value: string | undefined;
  rule.walkDecls(prop, (d) => {
    value = d.value;
  });
  return value;
}

/** Selector specificity (a, b, c) for the simple selectors used here (:is/:not take their max). */
function specificity(selector: string): [number, number, number] {
  const add = (x: [number, number, number], y: [number, number, number]) =>
    [x[0] + y[0], x[1] + y[1], x[2] + y[2]] as [number, number, number];
  const max = (list: [number, number, number][]) =>
    list.reduce((m, s) => (s[0] > m[0] || (s[0] === m[0] && (s[1] > m[1] || (s[1] === m[1] && s[2] > m[2]))) ? s : m), [0, 0, 0]);
  let total: [number, number, number] = [0, 0, 0];
  let rest = selector;
  // :is(...) / :not(...) — specificity of the most specific argument; :where(...) — zero.
  const fn = /:(is|not|where)\(/;
  for (;;) {
    const m = fn.exec(rest);
    if (!m) break;
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < rest.length && depth > 0; i++) {
      if (rest[i] === "(") depth++;
      else if (rest[i] === ")") depth--;
    }
    const inner = rest.slice(start, i - 1);
    const args: string[] = [];
    let level = 0;
    let cur = "";
    for (const ch of inner) {
      if (ch === "(") level++;
      if (ch === ")") level--;
      if (ch === "," && level === 0) {
        args.push(cur);
        cur = "";
      } else cur += ch;
    }
    args.push(cur);
    if (m[1] !== "where") total = add(total, max(args.map((a) => specificity(a.trim()))));
    rest = rest.slice(0, m.index) + " " + rest.slice(i);
  }
  const ids = (rest.match(/#[\w-]+/g) ?? []).length;
  const classes = (rest.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const types = (rest.match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return add(total, [ids, classes, types]);
}

describe("ZOOM-01 — 16px text entry on coarse pointers", () => {
  const zoomRules = rulesMatching(
    (rule) => enclosingMedia(rule).includes("(pointer: coarse)") && decl(rule, "font-size") === "16px",
  );

  it("exists exactly once, inside @media (pointer: coarse)", () => {
    expect(zoomRules).toHaveLength(1);
  });

  it("targets text inputs, selects and textareas but not checkboxes/radios/buttons", () => {
    const selector = zoomRules[0].selector.replace(/\s+/g, " ");
    expect(selector).toContain("select");
    expect(selector).toContain("textarea");
    expect(selector).toMatch(/input:not\(/);
    for (const type of ["checkbox", "radio", "range", "file", "color", "button", "submit", "reset", "image"]) {
      expect(selector).toContain(`[type="${type}"]`);
    }
  });

  it("beats a single Tailwind font-size utility (e.g. .text-sm, .text-xs, .focus\\:text-sm:focus)", () => {
    const s = specificity(zoomRules[0].selector.replace(/\s+/g, " "));
    const beats = (other: [number, number, number]) =>
      s[0] > other[0] || (s[0] === other[0] && (s[1] > other[1] || (s[1] === other[1] && s[2] > other[2])));
    expect(beats([0, 1, 0])).toBe(true); // .text-sm
    expect(beats([0, 2, 0])).toBe(true); // .focus\:text-sm:focus
  });

  it("leaves intentionally larger fields alone", () => {
    expect(zoomRules[0].selector).toContain(":not(.text-lg, .text-xl, .text-2xl");
  });

  it("lets flex/grid text fields shrink below their (now larger) intrinsic width, at zero specificity", () => {
    // Without it a `flex-1` composer input keeps its size="20" width as a minimum and pushes
    // its send button out of narrow panels once the font is 16px.
    const rule = rulesMatching((r) => decl(r, "min-width") === "0" && r.selector.includes("textarea"))[0];
    expect(rule).toBeDefined();
    expect(rule.selector.trim().startsWith(":where(")).toBe(true);
    expect(specificity(rule.selector)).toEqual([0, 0, 0]);
    expect(rule.selector).toContain('[type="checkbox"]');
  });

  it("survives the Tailwind build (base layer is always emitted)", async () => {
    const result = await postcss([tailwindcss({ ...config, content: [{ raw: "text-sm", extension: "html" }] })]).process(
      source,
      { from: CSS_PATH },
    );
    const built = postcss.parse(result.css);
    let found = false;
    built.walkRules((rule) => {
      if (enclosingMedia(rule).includes("(pointer: coarse)") && decl(rule, "font-size") === "16px") found = true;
    });
    expect(found).toBe(true);
  }, 30_000);
});

describe("HOVER-01 — hand-written :hover rules only apply to hover-capable pointers", () => {
  it("gates every :hover rule except the scrollbar thumb", () => {
    const ungated = rulesMatching(
      (rule) =>
        rule.selector.includes(":hover") &&
        !rule.selector.includes("::-webkit-scrollbar") &&
        !enclosingMedia(rule).some((m) => m.includes("hover: hover")),
    ).map((r) => r.selector);
    expect(ungated).toEqual([]);
  });

  it("covers the three rules the audit found ungated", () => {
    for (const sel of [".dashboard-segment-btn:hover", ".data-table tbody tr:hover", ".glow-border-accent:hover::before"]) {
      const rule = rulesMatching((r) => r.selector === sel)[0];
      expect(rule, sel).toBeDefined();
      expect(enclosingMedia(rule)).toContain("(hover: hover) and (pointer: fine)");
    }
  });
});

describe("TOUCH-01 — segmented filters", () => {
  it("gives .dashboard-segment-btn a 44px minimum height on coarse pointers", () => {
    const rule = rulesMatching(
      (r) => r.selector === ".dashboard-segment-btn" && enclosingMedia(r).includes("(pointer: coarse)"),
    )[0];
    expect(rule).toBeDefined();
    expect(decl(rule, "min-height")).toBe("44px");
  });
});

describe("keyboard-aware chrome variables (critic-15) and safe areas (SAFEAREA-01)", () => {
  it("defaults --kb-inset to 0px on :root", () => {
    const root = rulesMatching((r) => r.selector === ":root" && enclosingMedia(r).length === 0)[0];
    expect(decl(root, "--kb-inset")).toBe("0px");
  });

  it("puts bottom chrome above the tab bar, the keyboard or the home indicator — whichever is taller", () => {
    const shell = rulesMatching((r) => r.selector === ".dashboard-shell" && enclosingMedia(r).length === 0)[0];
    expect(decl(shell, "--nav-inset")).toBe("0px");
    expect(decl(shell, "--chrome-bottom")).toBe("max(var(--nav-inset), var(--kb-inset), var(--safe-bottom))");
    expect(decl(shell, "--chrome-side")).toBe("max(var(--safe-left), var(--safe-right))");

    const mobile = rulesMatching(
      (r) => r.selector === ".dashboard-shell" && enclosingMedia(r).includes("(max-width: 1023.98px)"),
    )[0];
    expect(decl(mobile, "--nav-inset")).toBe("calc(4.75rem + var(--safe-bottom))");
    const typing = rulesMatching((r) => r.selector === '.dashboard-shell[data-text-entry="true"]')[0];
    expect(decl(typing, "--nav-inset")).toBe("0px");
  });

  it("pads in-flow content for the side safe areas", () => {
    const body = rulesMatching((r) => r.selector === "body" && decl(r, "background-color") !== undefined)[0];
    expect(decl(body, "padding-left")).toBe("var(--safe-left)");
    expect(decl(body, "padding-right")).toBe("var(--safe-right)");
  });
});
