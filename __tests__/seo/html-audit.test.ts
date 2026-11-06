/**
 * F21 / UI-004: the SEO site audit reports concrete issues measured on the merchant's own
 * pages — no fixtures, no estimates. Fixture HTML in __tests__/fixtures/seo/.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { cleanText, decodeEntities, scanHtml } from "@/lib/seo/html";
import { auditPage, fetchFailureIssue, pickProductUrls, runSiteAudit, TITLE_MAX } from "@/lib/seo/audit";
import { OutboundUrlError } from "@/lib/security/outbound-http";
import { PageFetchError, type FetchedPage } from "@/lib/seo/fetch-page";

const fixture = (name: string) => readFileSync(join(process.cwd(), "__tests__", "fixtures", "seo", name), "utf8");

function page(html: string | null, overrides: Partial<FetchedPage> = {}): FetchedPage {
  return {
    requestedUrl: "https://bayt-oud.example/",
    finalUrl: "https://bayt-oud.example/",
    status: 200,
    contentType: "text/html; charset=utf-8",
    html,
    truncated: false,
    redirects: [],
    xRobotsTag: null,
    ...overrides
  };
}

const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code).sort();

describe("scanHtml", () => {
  it("reads head tags and ignores comments, style, script, noscript and svg content", () => {
    const scan = scanHtml(fixture("healthy-home.html"));
    expect(scan.htmlLang).toBe("ar-SA");
    expect(scan.htmlDir).toBe("rtl");
    expect(scan.title).toBe("متجر بيت العود — عود وبخور فاخر بتوصيل سريع");
    expect(scan.titleCount).toBe(1); // <title> inside <style> and <svg> are not the page title
    expect(scan.metaDescription).toMatch(/^بيت العود/);
    expect(scan.metaViewport).toContain("width=device-width");
    expect(scan.canonical).toBe("https://www.bayt-oud.example/");
    expect(scan.h1).toEqual(["عود وبخور فاخر & أصيل"]);
    expect(scan.h1Count).toBe(1); // the commented-out <h1> does not count
    expect(scan.images).toEqual({ total: 2, missingAlt: 0, emptyAlt: 1, missingAltSamples: [] });
    expect(scan.jsonLdTypes).toEqual(expect.arrayContaining(["Organization", "WebSite"]));
    expect(scan.jsonLdInvalid).toBe(0);
    expect(scan.ogTitle).toBe("متجر بيت العود");
  });

  it("handles upper-case tags, unquoted / valueless attributes and broken JSON-LD", () => {
    const scan = scanHtml(fixture("broken-product.html"));
    expect(scan.metaRobots).toBe("NOINDEX, follow");
    expect(scan.titleCount).toBe(2);
    expect(scan.h1Count).toBe(2);
    expect(scan.images.total).toBe(4);
    expect(scan.images.missingAlt).toBe(2);
    expect(scan.images.emptyAlt).toBe(1);
    expect(scan.images.missingAltSamples).toEqual(["/a.jpg", "/b.jpg"]);
    expect(scan.jsonLdInvalid).toBe(1);
    expect(scan.htmlLang).toBeNull();
  });

  it("decodes entities and caps text", () => {
    expect(decodeEntities("A &amp; B &#1593;&#x648;&#x62F; &quot;x&quot; &unknown;")).toBe('A & B عود "x" &unknown;');
    expect(cleanText("  a \n\t b  ")).toBe("a b");
    expect(cleanText("x".repeat(400), 10)).toBe(`${"x".repeat(10)}…`);
  });

  it("keeps indexes right after characters whose lower-case form is longer (İ)", () => {
    const scan = scanHtml(`<html lang="tr"><head><title>İİİİ İstanbul</title></head><body><script>var a="</scrip";</script><h1>Başlık</h1></body></html>`);
    expect(scan.title).toBe("İİİİ İstanbul");
    expect(scan.h1).toEqual(["Başlık"]);
  });

  it("is bounded on hostile input", () => {
    const html = `<img>`.repeat(20_000) + `<h1>${"x".repeat(10_000)}</h1>`;
    const scan = scanHtml(html);
    expect(scan.images.total).toBe(20_000);
    expect(scan.images.missingAltSamples).toHaveLength(5);
    expect(Array.from(scan.h1[0]).length).toBeLessThanOrEqual(301);
  });
});

describe("auditPage", () => {
  it("finds nothing to report on a well-built Arabic home page", () => {
    const html = fixture("healthy-home.html");
    expect(auditPage(page(html), "home", scanHtml(html))).toEqual([]);
  });

  it("reports every concrete problem on a broken product page", () => {
    const html = fixture("broken-product.html");
    const issues = auditPage(page(html, { finalUrl: "https://bayt-oud.example/p/9" }), "product", scanHtml(html));
    expect(codes(issues)).toEqual(
      [
        "canonical_offsite",
        "h1_multiple",
        "img_alt_missing",
        "jsonld_invalid",
        "jsonld_product_missing",
        "lang_missing",
        "meta_description_missing",
        "noindex",
        "og_missing",
        "title_multiple",
        "title_too_long",
        "viewport_missing"
      ].sort()
    );
    const long = issues.find((i) => i.code === "title_too_long")!;
    expect(Array.from(long.evidence!).length).toBeGreaterThan(TITLE_MAX);
    expect(long.title.ar).toBeTruthy();
    expect(long.title.en).toContain("characters");
    expect(issues.find((i) => i.code === "img_alt_missing")!.evidence).toBe("/a.jpg\n/b.jpg");
    for (const i of issues) {
      expect(i.url).toBe("https://bayt-oud.example/p/9");
      expect(i.detail.ar && i.detail.en).toBeTruthy();
    }
  });

  it("flags an Arabic page without rtl and a missing title / description / h1", () => {
    const html = `<html lang="ar"><head><meta name="viewport" content="width=device-width"><link rel="canonical" href="/"></head><body><img src="/x.png" alt="x"></body></html>`;
    const issues = auditPage(page(html), "home", scanHtml(html));
    expect(codes(issues)).toEqual(
      ["dir_missing", "h1_missing", "jsonld_site_missing", "meta_description_missing", "og_missing", "title_missing"].sort()
    );
    expect(issues.find((i) => i.code === "title_missing")!.severity).toBe("critical");
  });

  it("reports X-Robots-Tag noindex, non-200 answers, non-HTML bodies and truncation", () => {
    const html = fixture("healthy-home.html");
    expect(codes(auditPage(page(html, { xRobotsTag: "noindex" }), "home", scanHtml(html)))).toEqual(["noindex"]);
    expect(auditPage(page(null, { status: 404 }), "home", null)).toMatchObject([{ code: "http_status", severity: "critical", evidence: "404" }]);
    expect(auditPage(page(null, { contentType: "application/json" }), "home", null)).toMatchObject([{ code: "not_html" }]);
    expect(codes(auditPage(page(html, { truncated: true }), "home", scanHtml(html)))).toEqual(["page_truncated"]);
  });
});

describe("fetch failures", () => {
  it("maps guard refusals, off-site redirects and network failures to honest issues", () => {
    expect(fetchFailureIssue("https://x.example/", new OutboundUrlError("blocked_address", "nope"))).toMatchObject({
      code: "url_refused",
      severity: "critical",
      evidence: "blocked_address"
    });
    expect(fetchFailureIssue("https://x.example/", new PageFetchError("redirect_offsite", "away", "salla.sa"))).toMatchObject({
      code: "redirect_offsite",
      evidence: "salla.sa"
    });
    expect(fetchFailureIssue("https://x.example/", new PageFetchError("timeout", "slow"))).toMatchObject({ code: "fetch_failed", evidence: "timeout" });
  });
});

describe("pickProductUrls", () => {
  it("keeps only distinct https product pages on the store's own site, capped at 3", () => {
    const store = "https://bayt-oud.example/";
    const picked = pickProductUrls(store, [
      "https://bayt-oud.example/p/1#reviews",
      "https://www.bayt-oud.example/p/2",
      "http://bayt-oud.example/p/3",
      "https://evil.example/p/4",
      "https://user:pw@bayt-oud.example/p/5",
      "https://bayt-oud.example:6379/p/8",
      "https://bayt-oud.example/p/1",
      "not a url",
      null,
      "https://bayt-oud.example/",
      "https://bayt-oud.example/p/6",
      "https://bayt-oud.example/p/7"
    ]);
    expect(picked).toEqual(["https://bayt-oud.example/p/1", "https://www.bayt-oud.example/p/2", "https://bayt-oud.example/p/6"]);
  });
});

describe("runSiteAudit", () => {
  it("audits the home page and product pages and summarises by severity", async () => {
    const home = fixture("healthy-home.html");
    const product = fixture("broken-product.html");
    const fetched: string[] = [];
    const result = await runSiteAudit(
      { storeUrl: "https://bayt-oud.example/", productUrls: ["https://bayt-oud.example/p/9"] },
      {
        fetchPage: async (url) => {
          fetched.push(url);
          return page(url.endsWith("/p/9") ? product : home, { requestedUrl: url, finalUrl: url });
        },
        now: () => Date.parse("2026-11-06T09:00:00Z")
      }
    );
    expect(fetched).toEqual(["https://bayt-oud.example/", "https://bayt-oud.example/p/9"]);
    expect(result.pages).toEqual([
      { url: "https://bayt-oud.example/", kind: "home", final_url: "https://bayt-oud.example/", status: 200, ok: true },
      { url: "https://bayt-oud.example/p/9", kind: "product", final_url: "https://bayt-oud.example/p/9", status: 200, ok: true }
    ]);
    expect(result.summary).toEqual({ critical: 1, warning: 8, info: 3, pages: 2 });
    expect(result.issues[0].severity).toBe("critical");
    expect(result.audited_at).toBe("2026-11-06T09:00:00.000Z");
  });

  it("stops after a refused home page instead of hammering the product pages", async () => {
    let calls = 0;
    const result = await runSiteAudit(
      { storeUrl: "https://bayt-oud.example/", productUrls: ["https://bayt-oud.example/p/1"] },
      {
        fetchPage: async () => {
          calls += 1;
          throw new PageFetchError("timeout", "slow");
        }
      }
    );
    expect(calls).toBe(1);
    expect(result.pages).toEqual([{ url: "https://bayt-oud.example/", kind: "home", final_url: null, status: null, ok: false }]);
    expect(result.issues.map((i) => i.code)).toEqual(["fetch_failed"]);
  });
});
