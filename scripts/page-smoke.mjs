#!/usr/bin/env node
/**
 * Real-stack page smoke test: every page route of the app, rendered by a running server.
 *
 * Seeds a throwaway auth user + Pro merchant (current DPA accepted), one AI employee and one
 * invoice with the service role, signs in through @supabase/ssr (so the cookies are exactly
 * what the app reads), then requests every `app/**\/page.tsx` route — dynamic segments filled
 * with the seeded ids — both signed in and anonymously. A page passes when it answers 2xx (or
 * a redirect to the expected place, e.g. /login for an anonymous dashboard request), is not a
 * 404, and its HTML carries no error document or streamed error digest. Everything seeded is
 * deleted at the end. Check the server's own log for errors too (the script cannot see it).
 *
 * Admin pages (/admin/**) are checked as the seeded user, who is a platform admin only when the
 * server under test was started with that email in PLATFORM_ADMIN_EMAILS: pass the same value in
 * PAGE_SMOKE_ADMIN_EMAIL (the script then seeds exactly that address). Without it, /admin/**
 * must redirect a non-admin away (that is what is checked instead).
 *
 * Usage (app already running, e.g. `next start -p 3125`):
 *   PAGE_SMOKE_BASE_URL=http://localhost:3125 \
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
 *   [PAGE_SMOKE_ADMIN_EMAIL=ops-smoke@example.test] node scripts/page-smoke.mjs [--json <file>]
 *
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are accepted as fallbacks.
 * Exit code: 0 all pages passed, 1 a page failed, 2 setup problem.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = (process.env.PAGE_SMOKE_BASE_URL ?? "http://localhost:3125").replace(/\/$/, "");
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = process.env.PAGE_SMOKE_ADMIN_EMAIL?.trim().toLowerCase() || null;
const JSON_OUT = (() => {
  const i = process.argv.indexOf("--json");
  return i > -1 ? process.argv[i + 1] : undefined;
})();

/**
 * How a broken render shows up in a response. Not used: the text of the not-found page — Next
 * embeds the not-found boundary ("This page could not be found") in every page's RSC payload;
 * a real not-found answers HTTP 404, which the status check catches.
 */
const ERROR_SIGNALS = [
  // Next's error document (render failed before the shell was sent).
  { name: "error document", test: (html) => /<html[^>]*id="__next_error__"/.test(html) },
  // An error thrown while streaming: the RSC payload carries a numeric digest. NEXT_REDIRECT and
  // NEXT_HTTP_ERROR_FALLBACK digests are not numeric and are expected control flow.
  { name: "streamed error digest", test: (html) => /\\?"digest\\?":\\?"\d+/.test(html) },
];

/** All page routes under app/, with route groups removed. */
function pageRoutes(dir = path.join(ROOT, "app"), prefix = "") {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name.startsWith("_") || name === "api") continue;
      const segment = name.startsWith("(") && name.endsWith(")") ? "" : `/${name}`;
      out.push(...pageRoutes(full, prefix + segment));
    } else if (name === "page.tsx" || name === "page.ts") {
      out.push(prefix || "/");
    }
  }
  return [...new Set(out)].sort();
}

/** Keep the seeded merchant on the current DPA so the re-accept banner does not interfere. */
function currentDpaVersion() {
  const src = readFileSync(path.join(ROOT, "lib/legal/dpa.ts"), "utf8");
  const m = src.match(/CURRENT_DPA_VERSION\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
}

function firstCatalogSlug() {
  const src = readFileSync(path.join(ROOT, "lib/employees/catalog.ts"), "utf8");
  const m = src.match(/slug:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

const isPublic = (route) =>
  route === "/" ||
  ["/about", "/ar", "/careers", "/manifesto", "/press", "/maroof", "/login", "/signup", "/legal"].some(
    (p) => route === p || route.startsWith(`${p}/`)
  );

function fill(route, ids) {
  return route
    .replace("/employees/[id]", `/employees/${ids.employeeId}`)
    .replace("/invoices/[id]", `/invoices/${ids.invoiceId}`)
    .replace("/admin/merchants/[id]", `/admin/merchants/${ids.merchantId}`)
    .replace("/marketplace/[slug]", `/marketplace/${ids.slug}`);
}

async function fetchPage(url, cookieHeader) {
  const res = await fetch(url, {
    redirect: "manual",
    headers: { ...(cookieHeader ? { cookie: cookieHeader } : {}), accept: "text/html" },
  });
  const body = res.status >= 300 && res.status < 400 ? "" : await res.text();
  return { status: res.status, location: res.headers.get("location"), body };
}

async function main() {
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    console.error("✗ Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (or the NEXT_PUBLIC_* equivalents).");
    process.exit(2);
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const run = randomUUID().slice(0, 8);
  const email = ADMIN_EMAIL ?? `page-smoke-${run}@example.test`;
  const password = `pw-${randomUUID()}`;
  const merchantId = randomUUID();
  const ids = { merchantId, employeeId: randomUUID(), invoiceId: randomUUID(), slug: firstCatalogSlug() };
  let userId = null;
  const results = [];

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) {
    console.error(`✗ could not create ${email}: ${created.error.message}`);
    process.exit(2);
  }
  userId = created.data.user.id;

  try {
    const dpaVersion = currentDpaVersion();
    const m = await admin.from("merchants").insert({
      id: merchantId,
      owner_user_id: userId,
      seller_name: "متجر فحص الصفحات",
      store_url: "https://page-smoke.example",
      plan: "pro",
      subscription_status: "active",
      ...(dpaVersion ? { dpa_version: dpaVersion, dpa_accepted_at: new Date().toISOString() } : {}),
    });
    if (m.error) throw new Error(`seed merchant: ${m.error.message}`);
    const e = await admin.from("ai_employees").insert({
      id: ids.employeeId,
      merchant_id: merchantId,
      role_id: "support-agent",
      display_name: `Smoke ${run}`,
    });
    if (e.error) throw new Error(`seed employee: ${e.error.message}`);
    const inv = await admin.from("invoices").insert({
      id: ids.invoiceId,
      merchant_id: merchantId,
      invoice_number: `SMOKE-${run}`,
      uuid: randomUUID(),
      icv: 1,
      invoice_hash: "c21va2U=",
      qr_base64: "",
      xml: "<Invoice/>",
      status: "generated",
    });
    if (inv.error) throw new Error(`seed invoice: ${inv.error.message}`);

    const jar = new Map();
    const ssr = createServerClient(SUPABASE_URL, ANON_KEY, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (items) => items.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
      },
    });
    const signIn = await ssr.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`sign in: ${signIn.error.message}`);
    const cookieHeader = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

    const routes = pageRoutes();
    console.log(`page-smoke: ${BASE_URL} · ${routes.length} page routes · merchant ${merchantId}${ADMIN_EMAIL ? " · platform admin" : ""}`);

    for (const route of routes) {
      const url = `${BASE_URL}${fill(route, ids)}`;
      for (const who of ["signed-in", "anonymous"]) {
        const r = await fetchPage(url, who === "signed-in" ? cookieHeader : null);
        const marker = ERROR_SIGNALS.find((sig) => sig.test(r.body))?.name;
        let pass;
        let detail = `${r.status}${r.location ? ` → ${r.location}` : ""}`;
        if (r.status >= 500 || r.status === 404 || marker) {
          pass = false;
          if (marker) detail += ` (${marker})`;
        } else if (who === "anonymous" && !isPublic(route) && route !== "/auth/switch") {
          // A protected page must not render for an anonymous visitor: expect a redirect to /login.
          pass = r.status >= 300 && r.status < 400 && /\/login/.test(r.location ?? "");
        } else if (who === "signed-in" && route.startsWith("/admin") && !ADMIN_EMAIL) {
          // A merchant who is not a platform admin is sent away from /admin.
          pass = (r.status >= 300 && r.status < 400) || r.status === 404 || r.status === 403;
        } else {
          pass = r.status >= 200 && r.status < 400;
        }
        results.push({ route, url, who, status: r.status, location: r.location, pass, detail });
      }
    }
  } finally {
    await admin.from("invoices").delete().eq("merchant_id", merchantId);
    await admin.from("ai_employees").delete().eq("merchant_id", merchantId);
    await admin.from("salla_store_links").delete().eq("merchant_id", merchantId);
    await admin.from("merchants").delete().eq("id", merchantId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  }

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? "✓" : "✗"} [${r.who}] ${r.route} — ${r.detail}`);
  console.log(`\n${results.length - failed.length}/${results.length} page checks passed${failed.length ? `, ${failed.length} FAILED` : ""}.`);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ baseUrl: BASE_URL, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("✗ page-smoke failed:", err instanceof Error ? err.message : String(err));
  process.exit(2);
});
