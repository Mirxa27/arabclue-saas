#!/usr/bin/env node
/**
 * Real-browser mobile layout check for the dashboard chrome (mobile-core stream).
 *
 * Runs Playwright Chromium with touch emulation (isMobile + hasTouch → `(pointer: coarse)`)
 * at 320×568, 375×667, 390×844 and 667×375 (landscape) against a running app, signed in as a
 * throwaway merchant, and asserts the properties the mobile audit measured:
 *
 *   MNAV-01      every bottom tab is the element at its own centre; the closed More sheet is
 *                below the viewport, inert and invisible
 *   TWALPHA-01   the tab bar, More sheet and panels have a real (non-transparent) background,
 *                in light and dark mode
 *   MORESHEET-01 the open sheet fits the viewport; "Log out" is fully visible
 *   ZOOM-01      every text input / textarea / select computes to ≥ 16px on a coarse pointer
 *   PANEL-01     support panel and onboarding chat (header + close button) stay on screen
 *   FEEDBACK-01  no feedback card by default; its X dismisses it, also after a reload
 *   TOUCH-01     chrome controls are ≥ 44×44; segmented filters ≥ 44px tall
 *   STACK-01     <main> creates no stacking context (z-index auto)
 *   TOAST-01     the toast region lies inside the viewport
 *   SAFEAREA-01  with simulated notch insets the tab bar, launchers and content move inside them
 *   VH-01        the shell's min-height is the dynamic viewport height
 *   critic-15    focusing a text field slides the tab bar + launchers away; with an iOS-style
 *                --kb-inset the open support panel sits above the keyboard
 *   (always)     no horizontal overflow: scrollWidth <= innerWidth
 *
 * Usage (app already running, e.g. `next start -p 3115`):
 *   MOBILE_CHECK_BASE_URL=http://localhost:3115 \
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
 *   node scripts/mobile-check.mjs [--screenshots <dir>] [--json <file>]
 *
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are accepted as fallbacks. The
 * script creates an auth user + merchant with the service role, signs in through @supabase/ssr
 * (so the cookies are exactly what the app reads), and deletes both at the end. Playwright is
 * not a project dependency: it is resolved from the environment (NODE_PATH / global install).
 * Exit code: 0 all checks passed, 1 a check failed, 2 setup problem.
 */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const BASE_URL = (process.env.MOBILE_CHECK_BASE_URL ?? "http://localhost:3115").replace(/\/$/, "");
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SCREENSHOT_DIR = arg("--screenshots");
const JSON_OUT = arg("--json");

const VIEWPORTS = [
  { name: "320x568", width: 320, height: 568 },
  { name: "375x667", width: 375, height: 667 },
  { name: "390x844", width: 390, height: 844 },
  { name: "667x375", width: 667, height: 375 },
];

/** Small settle time for transitions (tab bar 200ms, sheet 300ms, panel scale-in 250ms). */
const SETTLE_MS = 450;

function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    return null;
  }
}

/** Keep the seeded merchant on the current DPA so the re-accept banner does not interfere. */
function currentDpaVersion() {
  const src = readFileSync(path.join(ROOT, "lib/legal/dpa.ts"), "utf8");
  const m = src.match(/CURRENT_DPA_VERSION\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
}

const results = [];
function record(viewport, page, check, pass, detail) {
  results.push({ viewport, page, check, pass: Boolean(pass), detail });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── in-page probes ──────────────────────────────────────────────────────────────────────────

/** Serialisable DOMRect + "is it the element at its own centre". */
const PROBES = `
  window.__mc = {
    rect(el) {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10, left: Math.round(r.left * 10) / 10, right: Math.round(r.right * 10) / 10, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 };
    },
    hit(el) {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { ok: !!hit && (hit === el || el.contains(hit)), hit: hit ? (hit.getAttribute('aria-label') || hit.id || hit.tagName) : null };
    },
    transparent(color) {
      return !color || color === 'transparent' || /rgba\\([^)]*,\\s*0\\)$/.test(color) || /\\/\\s*0\\)$/.test(color);
    },
    nav() { return document.querySelector('nav[aria-label="Primary mobile navigation"]'); },
    sheet() { return document.getElementById('mobile-more-sheet'); },
    overflow() { return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }; },
    textFields() {
      const sel = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]):not([type=button]):not([type=submit]):not([type=reset]):not([type=image]):not([type=hidden]), textarea, select';
      return [...document.querySelectorAll(sel)]
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => ({ name: el.id || el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('placeholder') || el.tagName, fontSize: parseFloat(getComputedStyle(el).fontSize) }));
    },
  };
`;

async function preparePage(page) {
  await page.addInitScript(PROBES);
}

async function gotoAndHydrate(page, urlPath, readySelector) {
  const res = await page.goto(`${BASE_URL}${urlPath}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(readySelector, { timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  return res;
}

async function shot(page, viewport, label) {
  if (!SCREENSHOT_DIR) return;
  const file = path.join(SCREENSHOT_DIR, `${viewport}-${label}.png`);
  await page.screenshot({ path: file });
  return file;
}

// ── checks ──────────────────────────────────────────────────────────────────────────────────

async function checkDashboard(page, vp) {
  const P = "/dashboard";
  const res = await gotoAndHydrate(page, P, 'button[aria-label*="Share feedback"]');
  record(vp.name, P, "page renders (200, signed in)", res?.status() === 200 && new URL(page.url()).pathname === P, `${res?.status()} ${page.url()}`);

  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  record(vp.name, P, "touch emulation → (pointer: coarse)", coarse, String(coarse));

  const closed = await page.evaluate(() => {
    const mc = window.__mc;
    const nav = mc.nav();
    const sheet = mc.sheet();
    const navStyle = getComputedStyle(nav);
    const tabs = [...nav.querySelectorAll("a, button")].map((t) => ({ label: (t.getAttribute("aria-label") || t.textContent || "").trim(), ...mc.hit(t), rect: mc.rect(t) }));
    const main = document.querySelector("main");
    const shell = document.querySelector(".dashboard-shell");
    const toast = document.querySelector('[data-testid="toast-region"]');
    const support = document.querySelector('button[aria-label="Open support chat"]');
    const feedback = document.querySelector('button[aria-label*="Share feedback"]');
    return {
      overflow: mc.overflow(),
      navBg: navStyle.backgroundColor,
      navBgTransparent: mc.transparent(navStyle.backgroundColor),
      navRect: mc.rect(nav),
      sheetRect: mc.rect(sheet),
      sheetVisibility: getComputedStyle(sheet).visibility,
      sheetInert: sheet.hasAttribute("inert"),
      sheetRole: sheet.getAttribute("role"),
      tabs,
      mainZ: getComputedStyle(main).zIndex,
      mainPb: parseFloat(getComputedStyle(main).paddingBottom),
      shellMinH: parseFloat(getComputedStyle(shell).minHeight),
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      toastRect: toast ? mc.rect(toast) : null,
      supportRect: support ? mc.rect(support) : null,
      supportHit: support ? mc.hit(support) : null,
      feedbackRect: feedback ? mc.rect(feedback) : null,
      feedbackHit: feedback ? mc.hit(feedback) : null,
      feedbackCardOpen: !!document.getElementById("feedback-card"),
      supportBottomGap: support ? window.innerHeight - support.getBoundingClientRect().bottom : null,
    };
  });

  record(vp.name, P, "no horizontal overflow", closed.overflow.scrollWidth <= closed.overflow.innerWidth, `${closed.overflow.scrollWidth} <= ${closed.overflow.innerWidth}`);
  record(vp.name, P, "TWALPHA-01 tab bar background is not transparent", !closed.navBgTransparent, closed.navBg);
  record(vp.name, P, "MNAV-01 closed sheet top >= viewport height", closed.sheetRect.top >= closed.innerHeight - 0.5, `top ${closed.sheetRect.top} vs ${closed.innerHeight}`);
  record(vp.name, P, "MNAV-01 closed sheet inert + hidden + no dialog role", closed.sheetInert && closed.sheetVisibility === "hidden" && !closed.sheetRole, `inert=${closed.sheetInert} visibility=${closed.sheetVisibility} role=${closed.sheetRole}`);
  for (const tab of closed.tabs) {
    record(vp.name, P, `MNAV-01 elementFromPoint(centre) is the "${tab.label}" tab`, tab.ok, `hit=${tab.hit}`);
    record(vp.name, P, `TOUCH-01 "${tab.label}" tab >= 44x44`, tab.rect.width >= 44 && tab.rect.height >= 44, `${tab.rect.width}x${tab.rect.height}`);
  }
  record(vp.name, P, "STACK-01 <main> z-index is auto (no stacking context)", closed.mainZ === "auto", closed.mainZ);
  record(vp.name, P, "main bottom padding clears tab bar + launchers (>= 144px)", closed.mainPb >= 144, `${closed.mainPb}px`);
  record(vp.name, P, "VH-01 shell min-height == dynamic viewport height", Math.abs(closed.shellMinH - closed.innerHeight) <= 1, `${closed.shellMinH} vs ${closed.innerHeight}`);
  record(vp.name, P, "TOAST-01 toast region inside the viewport", !!closed.toastRect && closed.toastRect.left >= 0 && closed.toastRect.right <= closed.innerWidth && closed.toastRect.top >= 0, JSON.stringify(closed.toastRect));
  record(vp.name, P, "FEEDBACK-01 no feedback card open by default", !closed.feedbackCardOpen, `card open=${closed.feedbackCardOpen}`);
  record(vp.name, P, "FEEDBACK-01 feedback launcher 44x44 and hittable", !!closed.feedbackRect && closed.feedbackRect.width >= 44 && closed.feedbackRect.height >= 44 && closed.feedbackHit?.ok, `${closed.feedbackRect?.width}x${closed.feedbackRect?.height} hit=${closed.feedbackHit?.hit}`);
  record(vp.name, P, "support launcher >= 44px, hittable, above the tab bar", !!closed.supportRect && closed.supportRect.height >= 44 && closed.supportRect.width >= 44 && closed.supportHit?.ok && closed.supportRect.bottom <= closed.navRect.top, `${closed.supportRect?.width}x${closed.supportRect?.height} bottom ${closed.supportRect?.bottom} nav top ${closed.navRect.top}`);
  await shot(page, vp.name, "dashboard");

  // ── More sheet open ──
  await page.tap('button[aria-label="More navigation options"]');
  await sleep(SETTLE_MS);
  const open = await page.evaluate(() => {
    const mc = window.__mc;
    const sheet = mc.sheet();
    const nav = mc.nav();
    const logout = [...sheet.querySelectorAll("button")].find((b) => /Log out/.test(b.textContent || ""));
    const close = sheet.querySelector('button[aria-label="Close menu"]');
    const s = sheet.getBoundingClientRect();
    const l = logout.getBoundingClientRect();
    const visibleTop = Math.max(l.top, s.top, 0);
    const visibleBottom = Math.min(l.bottom, s.bottom, window.innerHeight);
    return {
      sheetRect: mc.rect(sheet),
      navTop: nav.getBoundingClientRect().top,
      sheetBg: getComputedStyle(sheet).backgroundColor,
      sheetBgTransparent: mc.transparent(getComputedStyle(sheet).backgroundColor),
      role: sheet.getAttribute("role"),
      inert: sheet.hasAttribute("inert"),
      logoutHeight: Math.round(l.height * 10) / 10,
      logoutVisible: Math.round(Math.max(0, visibleBottom - visibleTop) * 10) / 10,
      logoutHit: mc.hit(logout),
      closeRect: mc.rect(close),
      focused: document.activeElement?.getAttribute("aria-label"),
      firstItemHit: mc.hit(sheet.querySelector(".grid a")),
      overflow: mc.overflow(),
    };
  });
  record(vp.name, P, "More sheet opens as a dialog (not inert)", open.role === "dialog" && !open.inert, `role=${open.role} inert=${open.inert}`);
  record(vp.name, P, "TWALPHA-01 More sheet background is not transparent", !open.sheetBgTransparent, open.sheetBg);
  record(vp.name, P, "MORESHEET-01 open sheet top inside the viewport", open.sheetRect.top >= 0, `top ${open.sheetRect.top}`);
  record(vp.name, P, "MORESHEET-01 open sheet ends on the tab bar", Math.abs(open.sheetRect.bottom - open.navTop) <= 1, `${open.sheetRect.bottom} vs ${open.navTop}`);
  record(vp.name, P, "MORESHEET-01 Log out fully visible + hittable", open.logoutVisible >= open.logoutHeight - 0.5 && open.logoutHit.ok, `${open.logoutVisible}/${open.logoutHeight}px hit=${open.logoutHit.hit}`);
  record(vp.name, P, "TOUCH-01 sheet close button >= 44x44", open.closeRect.width >= 44 && open.closeRect.height >= 44, `${open.closeRect.width}x${open.closeRect.height}`);
  record(vp.name, P, "MNAV-01 initial focus lands on the close button", open.focused === "Close menu", String(open.focused));
  record(vp.name, P, "More sheet module links hittable", open.firstItemHit.ok, `hit=${open.firstItemHit.hit}`);
  record(vp.name, P, "no horizontal overflow (sheet open)", open.overflow.scrollWidth <= open.overflow.innerWidth, `${open.overflow.scrollWidth} <= ${open.overflow.innerWidth}`);
  await shot(page, vp.name, "more-sheet");

  await page.tap('#mobile-more-sheet button[aria-label="Close menu"]');
  await sleep(SETTLE_MS);
  const reclosed = await page.evaluate(() => ({
    top: window.__mc.sheet().getBoundingClientRect().top,
    innerHeight: window.innerHeight,
    focused: document.activeElement?.getAttribute("aria-label"),
    moreHit: window.__mc.hit(document.querySelector('button[aria-label="More navigation options"]')),
  }));
  record(vp.name, P, "sheet closes off-screen again; focus back on More; More tappable", reclosed.top >= reclosed.innerHeight - 0.5 && reclosed.focused === "More navigation options" && reclosed.moreHit.ok, JSON.stringify(reclosed));

  // ── Support panel ──
  await page.tap('button[aria-label="Open support chat"]');
  await sleep(SETTLE_MS);
  const support = await page.evaluate(() => {
    const mc = window.__mc;
    const panel = document.querySelector('[role="dialog"][aria-labelledby="support-form-title"]');
    const close = panel.querySelector('button[aria-label="Close support"]');
    const nav = mc.nav();
    return {
      rect: mc.rect(panel),
      bg: getComputedStyle(panel).backgroundColor,
      bgTransparent: mc.transparent(getComputedStyle(panel).backgroundColor),
      closeRect: mc.rect(close),
      closeHit: mc.hit(close),
      navTop: nav.getBoundingClientRect().top,
      innerHeight: window.innerHeight,
      fields: ["support-email", "support-message"].map((id) => ({ id, fontSize: parseFloat(getComputedStyle(document.getElementById(id)).fontSize) })),
      feedbackLauncher: !!document.querySelector('button[aria-label*="Share feedback"]'),
      overflow: mc.overflow(),
    };
  });
  record(vp.name, P, "PANEL-01 support panel top >= 16px (header on screen)", support.rect.top >= 15.5, `top ${support.rect.top}`);
  record(vp.name, P, "PANEL-01 support panel bottom above the tab bar", support.rect.bottom <= support.navTop + 0.5, `${support.rect.bottom} vs nav ${support.navTop}`);
  record(vp.name, P, "PANEL-01/TOUCH-01 support close button on screen, 44x44, hittable", support.closeRect.top >= 0 && support.closeRect.width >= 44 && support.closeRect.height >= 44 && support.closeHit.ok, `${JSON.stringify(support.closeRect)} hit=${support.closeHit.hit}`);
  record(vp.name, P, "TWALPHA-01 support panel background is not transparent", !support.bgTransparent, support.bg);
  for (const f of support.fields) record(vp.name, P, `ZOOM-01 ${f.id} font-size >= 16px`, f.fontSize >= 16, `${f.fontSize}px`);
  record(vp.name, P, "FEEDBACK-01 feedback widget hidden while support is open", !support.feedbackLauncher, `launcher present=${support.feedbackLauncher}`);
  record(vp.name, P, "no horizontal overflow (support open)", support.overflow.scrollWidth <= support.overflow.innerWidth, `${support.overflow.scrollWidth} <= ${support.overflow.innerWidth}`);
  await shot(page, vp.name, "support-panel");

  // critic-15: typing in the panel → tab bar slides away, panel drops onto the keyboard edge.
  await page.tap("#support-message");
  await sleep(SETTLE_MS);
  const typing = await page.evaluate(() => {
    const mc = window.__mc;
    const nav = mc.nav();
    const panel = document.querySelector('[role="dialog"][aria-labelledby="support-form-title"]');
    return {
      textEntry: document.querySelector(".dashboard-shell").dataset.textEntry ?? null,
      navVisibility: getComputedStyle(nav).visibility,
      navTop: nav.getBoundingClientRect().top,
      navInert: nav.hasAttribute("inert"),
      panelBottomGap: window.innerHeight - panel.getBoundingClientRect().bottom,
      innerHeight: window.innerHeight,
    };
  });
  record(vp.name, P, "critic-15 focusing a field marks text entry + hides the tab bar", typing.textEntry === "true" && typing.navVisibility === "hidden" && typing.navInert && typing.navTop >= typing.innerHeight - 0.5, JSON.stringify(typing));
  record(vp.name, P, "critic-15 open panel drops to the bottom edge while typing", typing.panelBottomGap <= 13, `gap ${typing.panelBottomGap}px`);

  // critic-15: iOS-style keyboard (layout viewport not resized) → --kb-inset lifts the panel.
  const kb = await page.evaluate(async () => {
    document.documentElement.style.setProperty("--kb-inset", "300px");
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const panel = document.querySelector('[role="dialog"][aria-labelledby="support-form-title"]');
    const r = panel.getBoundingClientRect();
    const out = { bottomGap: Math.round((window.innerHeight - r.bottom) * 10) / 10, top: Math.round(r.top * 10) / 10 };
    document.documentElement.style.removeProperty("--kb-inset");
    return out;
  });
  record(vp.name, P, "critic-15 with --kb-inset 300px the panel sits above the keyboard and still fits", kb.bottomGap >= 300 && kb.top >= 15.5, JSON.stringify(kb));

  await page.evaluate(() => document.activeElement?.blur());
  await sleep(SETTLE_MS);
  const typedDone = await page.evaluate(() => ({
    textEntry: document.querySelector(".dashboard-shell").dataset.textEntry ?? null,
    navVisibility: getComputedStyle(window.__mc.nav()).visibility,
  }));
  record(vp.name, P, "critic-15 tab bar returns after blur", typedDone.textEntry === null && typedDone.navVisibility === "visible", JSON.stringify(typedDone));

  await page.tap('button[aria-label="Close support"]');
  await sleep(SETTLE_MS);

  // ── Feedback card ──
  await page.tap('button[aria-label*="Share feedback"]');
  await sleep(SETTLE_MS);
  const fb = await page.evaluate(() => {
    const mc = window.__mc;
    const card = document.getElementById("feedback-card");
    const x = card.querySelector('button[aria-label*="Hide for 30 days"]');
    return { rect: mc.rect(card), bgTransparent: mc.transparent(getComputedStyle(card).backgroundColor), xRect: mc.rect(x), xHit: mc.hit(x), navTop: mc.nav().getBoundingClientRect().top };
  });
  record(vp.name, P, "FEEDBACK-01 card opens on demand, on screen, above the tab bar", fb.rect.top >= 15.5 && fb.rect.bottom <= fb.navTop + 0.5 && !fb.bgTransparent, JSON.stringify(fb.rect));
  record(vp.name, P, "FEEDBACK-01/TOUCH-01 card X is 44x44 and hittable", fb.xRect.width >= 44 && fb.xRect.height >= 44 && fb.xHit.ok, `${fb.xRect.width}x${fb.xRect.height} hit=${fb.xHit.hit}`);
  await shot(page, vp.name, "feedback-card");
  await page.tap('#feedback-card button[aria-label*="Hide for 30 days"]');
  await sleep(SETTLE_MS);
  const dismissed = await page.evaluate(() => ({ card: !!document.getElementById("feedback-card"), launcher: !!document.querySelector('button[aria-label*="Share feedback"]') }));
  record(vp.name, P, "FEEDBACK-01 X really dismisses (card + launcher gone)", !dismissed.card && !dismissed.launcher, JSON.stringify(dismissed));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[aria-label="Open support chat"]', { timeout: 30_000 });
  await sleep(SETTLE_MS);
  const afterReload = await page.evaluate(() => ({ launcher: !!document.querySelector('button[aria-label*="Share feedback"]'), card: !!document.getElementById("feedback-card") }));
  record(vp.name, P, "FEEDBACK-01 dismissal persists across a reload", !afterReload.launcher && !afterReload.card, JSON.stringify(afterReload));
  await page.evaluate(() => localStorage.removeItem("arabclue:feedback-prompt"));

  // Command palette (its `flex-1` search input is affected by the 16px rule too).
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("arabclue:command-palette")));
  await sleep(SETTLE_MS);
  const palette = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Go to page"]');
    if (!dialog) return null;
    const input = dialog.querySelector("input");
    const d = dialog.getBoundingClientRect();
    const i = input.getBoundingClientRect();
    return {
      inputFont: parseFloat(getComputedStyle(input).fontSize),
      inputInside: i.left >= d.left - 0.5 && i.right <= d.right + 0.5,
      dialogInside: d.left >= 0 && d.right <= window.innerWidth,
      overflow: window.__mc.overflow(),
    };
  });
  record(vp.name, P, "command palette search input >= 16px and inside its dialog", !!palette && palette.inputFont >= 16 && palette.inputInside && palette.dialogInside && palette.overflow.scrollWidth <= palette.overflow.innerWidth, JSON.stringify(palette));
  await page.keyboard.press("Escape");
  await sleep(SETTLE_MS);

  // ── SAFEAREA-01: simulated notch / home-indicator insets (Chromium reports 0 for env()) ──
  if (vp.width > vp.height) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('button[aria-label*="Share feedback"]', { timeout: 30_000 });
    const safe = await page.evaluate(async () => {
      const root = document.documentElement.style;
      root.setProperty("--safe-left", "47px");
      root.setProperty("--safe-right", "47px");
      root.setProperty("--safe-bottom", "21px");
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const mc = window.__mc;
      const nav = mc.nav();
      const dock = document.querySelector('[data-testid="chrome-fab-dock"]');
      const out = {
        navPadLeft: getComputedStyle(nav).paddingLeft,
        navPadRight: getComputedStyle(nav).paddingRight,
        navHeight: Math.round(nav.getBoundingClientRect().height),
        dockRightGap: Math.round(window.innerWidth - dock.getBoundingClientRect().right),
        dockBottomGap: Math.round(window.innerHeight - dock.getBoundingClientRect().bottom),
        bodyPadLeft: getComputedStyle(document.body).paddingLeft,
        overflow: mc.overflow(),
      };
      root.removeProperty("--safe-left");
      root.removeProperty("--safe-right");
      root.removeProperty("--safe-bottom");
      return out;
    });
    record(vp.name, P, "SAFEAREA-01 tab bar pads both side insets", safe.navPadLeft === "47px" && safe.navPadRight === "47px", `${safe.navPadLeft}/${safe.navPadRight}`);
    record(vp.name, P, "SAFEAREA-01 tab bar grows by the home-indicator inset", safe.navHeight === 97, `${safe.navHeight}px`);
    record(vp.name, P, "SAFEAREA-01 launchers clear the notch side (24+47px) and sit above the tab bar", safe.dockRightGap === 71 && safe.dockBottomGap >= 97 + 12 - 1, `right ${safe.dockRightGap}px bottom ${safe.dockBottomGap}px`);
    record(vp.name, P, "SAFEAREA-01 in-flow content padded by the side inset", safe.bodyPadLeft === "47px", safe.bodyPadLeft);
    record(vp.name, P, "no horizontal overflow (simulated insets)", safe.overflow.scrollWidth <= safe.overflow.innerWidth, `${safe.overflow.scrollWidth} <= ${safe.overflow.innerWidth}`);
  }
}

async function checkSettings(page, vp) {
  const P = "/settings";
  const res = await gotoAndHydrate(page, P, 'button[aria-label="Open support chat"]');
  await page.waitForSelector("main input", { timeout: 30_000 });
  record(vp.name, P, "page renders (200)", res?.status() === 200 && new URL(page.url()).pathname === P, `${res?.status()} ${page.url()}`);
  const data = await page.evaluate(() => ({ fields: window.__mc.textFields(), overflow: window.__mc.overflow() }));
  const small = data.fields.filter((f) => f.fontSize < 16);
  record(vp.name, P, `ZOOM-01 all ${data.fields.length} text fields >= 16px`, data.fields.length > 0 && small.length === 0, small.length ? JSON.stringify(small) : `min ${Math.min(...data.fields.map((f) => f.fontSize))}px`);
  record(vp.name, P, "no horizontal overflow", data.overflow.scrollWidth <= data.overflow.innerWidth, `${data.overflow.scrollWidth} <= ${data.overflow.innerWidth}`);

  // critic-15 on a page field: tab bar and launchers slide away while typing.
  const first = page.locator('main input:not([type="checkbox"]):not([type="radio"])').first();
  await first.scrollIntoViewIfNeeded();
  await first.tap();
  await sleep(SETTLE_MS);
  const typing = await page.evaluate(() => ({
    textEntry: document.querySelector(".dashboard-shell").dataset.textEntry ?? null,
    navVisibility: getComputedStyle(window.__mc.nav()).visibility,
    launchers: !!document.querySelector('button[aria-label="Open support chat"]') || !!document.querySelector('button[aria-label*="Share feedback"]'),
  }));
  record(vp.name, P, "critic-15 page field focus hides tab bar + launchers", typing.textEntry === "true" && typing.navVisibility === "hidden" && !typing.launchers, JSON.stringify(typing));
  await shot(page, vp.name, "settings-typing");
  await page.evaluate(() => document.activeElement?.blur());
  await sleep(SETTLE_MS);
}

async function checkSocial(page, vp) {
  const P = "/social";
  const res = await gotoAndHydrate(page, P, 'button[aria-label="Open support chat"]');
  record(vp.name, P, "page renders (200)", res?.status() === 200 && new URL(page.url()).pathname === P, `${res?.status()} ${page.url()}`);
  await page.waitForSelector(".dashboard-segment-btn", { timeout: 15_000 }).catch(() => {});
  const data = await page.evaluate(() => ({
    segments: [...document.querySelectorAll(".dashboard-segment-btn")].map((b) => Math.round(b.getBoundingClientRect().height * 10) / 10),
    overflow: window.__mc.overflow(),
  }));
  record(vp.name, P, `TOUCH-01 ${data.segments.length} segmented filter buttons >= 44px tall`, data.segments.length > 0 && data.segments.every((h) => h >= 44), JSON.stringify(data.segments));
  record(vp.name, P, "no horizontal overflow", data.overflow.scrollWidth <= data.overflow.innerWidth, `${data.overflow.scrollWidth} <= ${data.overflow.innerWidth}`);
}

async function checkWelcomeChat(page, vp) {
  const P = "/welcome";
  const res = await gotoAndHydrate(page, P, 'button[aria-label="محادثة مع سارة"]');
  record(vp.name, P, "page renders (200)", res?.status() === 200 && new URL(page.url()).pathname === P, `${res?.status()} ${page.url()}`);
  const fields = await page.evaluate(() => window.__mc.textFields());
  const small = fields.filter((f) => f.fontSize < 16);
  record(vp.name, P, `ZOOM-01 all ${fields.length} wizard fields >= 16px`, fields.length > 0 && small.length === 0, small.length ? JSON.stringify(small) : "ok");

  await page.tap('button[aria-label="محادثة مع سارة"]');
  await sleep(SETTLE_MS);
  const chat = await page.evaluate(() => {
    const mc = window.__mc;
    const panel = document.querySelector('[role="dialog"][aria-label*="Onboarding assistant"]');
    const close = panel.querySelector('button[aria-label*="Close chat"]');
    const input = panel.querySelector("input");
    const send = input.parentElement.querySelector("button");
    const p = panel.getBoundingClientRect();
    const inside = (el) => {
      const r = el.getBoundingClientRect();
      return r.left >= p.left - 0.5 && r.right <= p.right + 0.5;
    };
    return {
      rect: mc.rect(panel),
      closeRect: mc.rect(close),
      closeHit: mc.hit(close),
      inputFont: parseFloat(getComputedStyle(input).fontSize),
      composerInside: inside(input) && inside(send) && inside(close),
      sendRect: mc.rect(send),
      panelScrollLeft: panel.scrollLeft,
      panelScrollWidth: panel.scrollWidth,
      panelClientWidth: panel.clientWidth,
      innerHeight: window.innerHeight,
      overflow: mc.overflow(),
    };
  });
  record(vp.name, P, "onboarding chat composer (input + send) and header fit inside the panel", chat.composerInside && chat.panelScrollLeft === 0 && chat.panelScrollWidth <= chat.panelClientWidth, `send ${JSON.stringify(chat.sendRect)} panel ${chat.rect.left}–${chat.rect.right} scrollLeft ${chat.panelScrollLeft} scrollWidth ${chat.panelScrollWidth}/${chat.panelClientWidth}`);
  record(vp.name, P, "PANEL-01 onboarding chat top >= 16px", chat.rect.top >= 15.5, `top ${chat.rect.top}`);
  record(vp.name, P, "PANEL-01 onboarding chat clear of the bottom edge (>= 24px)", chat.innerHeight - chat.rect.bottom >= 23.5, `gap ${chat.innerHeight - chat.rect.bottom}px`);
  record(vp.name, P, "PANEL-01/TOUCH-01 chat close button on screen, 44x44, hittable", chat.closeRect.top >= 0 && chat.closeRect.width >= 44 && chat.closeRect.height >= 44 && chat.closeHit.ok, `${JSON.stringify(chat.closeRect)} hit=${chat.closeHit.hit}`);
  record(vp.name, P, "ZOOM-01 chat input >= 16px", chat.inputFont >= 16, `${chat.inputFont}px`);
  record(vp.name, P, "no horizontal overflow (chat open)", chat.overflow.scrollWidth <= chat.overflow.innerWidth, `${chat.overflow.scrollWidth} <= ${chat.overflow.innerWidth}`);
  await shot(page, vp.name, "onboarding-chat");
  await page.tap('[role="dialog"][aria-label*="Onboarding assistant"] button[aria-label*="Close chat"]');
  await sleep(SETTLE_MS);
  const closed = await page.evaluate(() => !document.querySelector('[role="dialog"][aria-label*="Onboarding assistant"]'));
  record(vp.name, P, "onboarding chat closes from its close button", closed, String(closed));
}

async function checkDarkMode(browser, cookies) {
  const vp = { name: "390x844-dark", width: 390, height: 844 };
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: "dark" });
  await context.addCookies(cookies);
  const page = await context.newPage();
  await preparePage(page);
  await gotoAndHydrate(page, "/dashboard", 'button[aria-label*="Share feedback"]');
  const dark = await page.evaluate(() => {
    const bg = getComputedStyle(window.__mc.nav()).backgroundColor;
    const nums = (bg.match(/[\d.]+/g) || []).map(Number);
    return { bg, transparent: window.__mc.transparent(bg), nums };
  });
  // color-mix() computes to `color(srgb r g b / a)` (channels 0–1); rgb()/rgba() use 0–255.
  const scale = dark.bg.startsWith("color(") ? 1 : 255;
  const [r, g, b] = dark.nums;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / scale;
  record(vp.name, "/dashboard", "TWALPHA-01 dark mode tab bar has a dark, non-transparent background", !dark.transparent && luminance < 0.3, `${dark.bg} (luminance ${luminance.toFixed(2)})`);
  await shot(page, vp.name, "dashboard");
  await page.tap('button[aria-label="More navigation options"]');
  await sleep(SETTLE_MS);
  const sheetBg = await page.evaluate(() => getComputedStyle(window.__mc.sheet()).backgroundColor);
  record(vp.name, "/dashboard", "TWALPHA-01 dark mode More sheet background is not transparent", !/,\s*0\)$/.test(sheetBg) && sheetBg !== "transparent", sheetBg);
  await shot(page, vp.name, "more-sheet");
  await context.close();
}

// ── main ────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const playwright = loadPlaywright();
  if (!playwright) {
    console.error("✗ playwright is not resolvable (it is not a project dependency). Put it on NODE_PATH or install it globally.");
    process.exit(2);
  }
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    console.error("✗ Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (or the NEXT_PUBLIC_* equivalents).");
    process.exit(2);
  }
  if (SCREENSHOT_DIR) mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const run = randomUUID().slice(0, 8);
  const email = `mobile-check-${run}@example.test`;
  const password = `pw-${randomUUID()}`;
  const merchantId = randomUUID();
  let userId = null;

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user.id;

  let browser;
  try {
    const dpaVersion = currentDpaVersion();
    const ins = await admin.from("merchants").insert({
      id: merchantId,
      owner_user_id: userId,
      seller_name: "متجر فحص الجوال",
      store_url: "https://mobile-check.example",
      plan: "pro",
      subscription_status: "active",
      ...(dpaVersion ? { dpa_version: dpaVersion, dpa_accepted_at: new Date().toISOString() } : {}),
    });
    if (ins.error) throw ins.error;

    // Sign in exactly like the app's server client does, capturing the session cookies.
    const jar = new Map();
    const ssr = createServerClient(SUPABASE_URL, ANON_KEY, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (items) => items.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
      },
    });
    const signIn = await ssr.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    const cookies = [...jar].map(([name, value]) => ({ name, value, url: BASE_URL, sameSite: "Lax" }));

    browser = await playwright.chromium.launch();
    console.log(`mobile-check: ${BASE_URL} · Chromium ${browser.version()} · merchant ${merchantId}`);

    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        colorScheme: "light",
      });
      await context.addCookies(cookies);
      const page = await context.newPage();
      await preparePage(page);
      const steps = [checkDashboard, checkSettings, checkSocial, checkWelcomeChat];
      for (const step of steps) {
        try {
          await step(page, vp);
        } catch (err) {
          record(vp.name, step.name, "step completed without error", false, err instanceof Error ? err.message.split("\n")[0] : String(err));
        }
      }
      await context.close();
    }
    try {
      await checkDarkMode(browser, cookies);
    } catch (err) {
      record("390x844-dark", "/dashboard", "step completed without error", false, err instanceof Error ? err.message.split("\n")[0] : String(err));
    }
  } finally {
    if (browser) await browser.close();
    await admin.from("merchants").delete().eq("id", merchantId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  }

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? "✓" : "✗"} [${r.viewport}] ${r.page} — ${r.check}: ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `, ${failed.length} FAILED` : ""}.`);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ baseUrl: BASE_URL, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("✗ mobile-check setup failed:", err instanceof Error ? err.message : String(err));
  process.exit(2);
});
