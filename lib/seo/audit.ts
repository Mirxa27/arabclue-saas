/**
 * SEO site audit of the merchant's own store (F21 / UI-004).
 *
 * Fetches the store home page (merchants.store_url) and up to MAX_PRODUCT_PAGES product
 * pages from the merchant's synced catalogue (salla_products.url) that live on the same site,
 * through the outbound guard (lib/seo/fetch-page.ts), and reports concrete, checkable issues:
 * HTTP status, noindex, <title>, meta description, <h1>, image alt text, canonical, html
 * lang/dir, viewport, JSON-LD (Product on product pages, Organization/WebSite on the home
 * page) and Open Graph. Nothing is estimated: a page that cannot be fetched is reported as
 * such, and checks that need the page body are skipped for it.
 */
import { OutboundUrlError } from "@/lib/security/outbound-http";
import { fetchPublicPage, PageFetchError, sameSite, type FetchedPage } from "@/lib/seo/fetch-page";
import { scanHtml, type ScannedPage } from "@/lib/seo/html";
import type {
  AuditedPage,
  AuditedPageKind,
  Bilingual,
  SeoIssue,
  SeoIssueCode,
  SeoIssueSeverity,
  SiteAuditResult
} from "@/lib/seo/audit-types";

export type {
  AuditedPage,
  AuditedPageKind,
  Bilingual,
  SeoIssue,
  SeoIssueCode,
  SeoIssueSeverity,
  SiteAuditResult
} from "@/lib/seo/audit-types";

export const TITLE_MAX = 60;
export const TITLE_MIN = 15;
export const DESCRIPTION_MIN = 70;
export const DESCRIPTION_MAX = 160;
export const MAX_PRODUCT_PAGES = 3;
/** Stop starting new page fetches once the audit has run this long. */
export const AUDIT_BUDGET_MS = 30_000;

const SEVERITY_ORDER: Record<SeoIssueSeverity, number> = { critical: 0, warning: 1, info: 2 };

const SITE_SCHEMA_TYPES = new Set(["Organization", "WebSite", "Store", "OnlineStore", "LocalBusiness", "Corporation"]);

const len = (s: string) => Array.from(s).length;

function issue(
  code: SeoIssueCode,
  severity: SeoIssueSeverity,
  url: string,
  title: Bilingual,
  detail: Bilingual,
  evidence?: string | null
): SeoIssue {
  return { code, severity, url, title, detail, evidence: evidence ?? null };
}

/** Checks on one fetched, parsed page. Pure: everything comes from `page` and `scan`. */
export function auditPage(page: FetchedPage, kind: AuditedPageKind, scan: ScannedPage | null): SeoIssue[] {
  const url = page.finalUrl;
  const out: SeoIssue[] = [];

  if (page.status !== 200) {
    out.push(
      issue(
        "http_status",
        "critical",
        url,
        { ar: `الصفحة أعادت رمز الحالة ${page.status}`, en: `The page returned HTTP ${page.status}` },
        {
          ar: "محركات البحث لا تفهرس الصفحات التي لا تُعيد 200. تأكد أن الرابط صحيح ومتاح للزوار ولبرامج الزحف.",
          en: "Search engines only index pages that answer 200. Check the URL is correct and reachable for visitors and crawlers."
        },
        String(page.status)
      )
    );
    return out;
  }
  if (!scan) {
    out.push(
      issue(
        "not_html",
        "critical",
        url,
        { ar: "الرابط لا يُعيد صفحة HTML", en: "The URL does not return an HTML page" },
        {
          ar: "تحقّق أن رابط المتجر يشير إلى الصفحة الرئيسية وليس إلى ملف أو واجهة برمجية.",
          en: "Make sure the store URL points to the storefront page, not a file or an API."
        },
        page.contentType?.slice(0, 100) ?? null
      )
    );
    return out;
  }

  const robots = `${scan.metaRobots ?? ""} ${page.xRobotsTag ?? ""}`.toLowerCase();
  if (/\bnoindex\b|\bnone\b/.test(robots)) {
    out.push(
      issue(
        "noindex",
        "critical",
        url,
        { ar: "الصفحة مستبعدة من الفهرسة (noindex)", en: "The page is excluded from search (noindex)" },
        {
          ar: "وسم robots أو ترويسة X-Robots-Tag يطلب من جوجل عدم فهرسة الصفحة، فلن تظهر في نتائج البحث.",
          en: "A robots meta tag or X-Robots-Tag header tells Google not to index this page, so it cannot appear in results."
        },
        robots.trim().slice(0, 120)
      )
    );
  }

  if (!scan.title) {
    out.push(
      issue(
        "title_missing",
        "critical",
        url,
        { ar: "عنوان الصفحة (title) مفقود", en: "The page has no <title>" },
        {
          ar: "العنوان هو أول ما يظهر في نتائج البحث. أضف عنواناً وصفياً يتضمن الكلمة المفتاحية الأساسية.",
          en: "The title is the headline shown in search results. Add a descriptive title with your main keyword."
        }
      )
    );
  } else {
    const n = len(scan.title);
    if (n > TITLE_MAX) {
      out.push(
        issue(
          "title_too_long",
          "warning",
          url,
          { ar: `عنوان الصفحة طويل (${n} حرفاً)`, en: `The title is long (${n} characters)` },
          {
            ar: `تقطع جوجل العناوين الأطول من نحو ${TITLE_MAX} حرفاً. اختصره وابدأ بالأهم.`,
            en: `Google truncates titles beyond about ${TITLE_MAX} characters. Shorten it and lead with what matters.`
          },
          scan.title
        )
      );
    } else if (n < TITLE_MIN) {
      out.push(
        issue(
          "title_too_short",
          "info",
          url,
          { ar: `عنوان الصفحة قصير (${n} أحرف)`, en: `The title is short (${n} characters)` },
          {
            ar: "عنوان أوضح يذكر ما تبيعه يساعد الزوار ومحركات البحث.",
            en: "A clearer title that says what you sell helps shoppers and search engines."
          },
          scan.title
        )
      );
    }
    if (scan.titleCount > 1) {
      out.push(
        issue(
          "title_multiple",
          "info",
          url,
          { ar: `الصفحة تحتوي ${scan.titleCount} وسوم title`, en: `The page has ${scan.titleCount} <title> tags` },
          { ar: "اترك وسم عنوان واحداً فقط.", en: "Keep a single <title> tag." }
        )
      );
    }
  }

  if (!scan.metaDescription) {
    out.push(
      issue(
        "meta_description_missing",
        "warning",
        url,
        { ar: "الوصف التعريفي (meta description) مفقود", en: "The meta description is missing" },
        {
          ar: `أضف وصفاً من ${DESCRIPTION_MIN} إلى ${DESCRIPTION_MAX} حرفاً يشجّع على النقر، وإلا ستختار جوجل نصاً عشوائياً من الصفحة.`,
          en: `Add a ${DESCRIPTION_MIN}–${DESCRIPTION_MAX} character description that invites the click; otherwise Google picks arbitrary page text.`
        }
      )
    );
  } else {
    const n = len(scan.metaDescription);
    if (n < DESCRIPTION_MIN || n > DESCRIPTION_MAX) {
      out.push(
        issue(
          "meta_description_length",
          "info",
          url,
          { ar: `طول الوصف التعريفي ${n} حرفاً`, en: `The meta description is ${n} characters` },
          {
            ar: `الطول المناسب بين ${DESCRIPTION_MIN} و${DESCRIPTION_MAX} حرفاً.`,
            en: `Aim for ${DESCRIPTION_MIN}–${DESCRIPTION_MAX} characters.`
          },
          scan.metaDescription
        )
      );
    }
  }

  if (scan.h1Count === 0) {
    out.push(
      issue(
        "h1_missing",
        "warning",
        url,
        { ar: "لا يوجد عنوان رئيسي (h1)", en: "No <h1> heading" },
        {
          ar: "عنوان h1 واحد يصف محتوى الصفحة يساعد جوجل على فهمها.",
          en: "One <h1> describing the page helps Google understand it."
        }
      )
    );
  } else if (scan.h1Count > 1) {
    out.push(
      issue(
        "h1_multiple",
        "info",
        url,
        { ar: `الصفحة تحتوي ${scan.h1Count} عناوين h1`, en: `The page has ${scan.h1Count} <h1> headings` },
        {
          ar: "يُفضَّل عنوان h1 واحد، واستخدام h2/h3 للأقسام.",
          en: "Prefer a single <h1> and use <h2>/<h3> for sections."
        },
        scan.h1.slice(0, 3).join(" | ") || null
      )
    );
  }

  if (scan.images.missingAlt > 0) {
    out.push(
      issue(
        "img_alt_missing",
        "warning",
        url,
        {
          ar: `${scan.images.missingAlt} من ${scan.images.total} صورة بلا نص بديل (alt)`,
          en: `${scan.images.missingAlt} of ${scan.images.total} images have no alt text`
        },
        {
          ar: "النص البديل يصف الصورة لمحركات البحث ولقارئات الشاشة. صف المنتج بالعربية.",
          en: "Alt text describes images to search engines and screen readers. Describe the product in Arabic."
        },
        scan.images.missingAltSamples.join("\n") || null
      )
    );
  }

  if (!scan.canonical) {
    out.push(
      issue(
        "canonical_missing",
        "warning",
        url,
        { ar: "رابط canonical مفقود", en: "No canonical link" },
        {
          ar: "وسم canonical يمنع تكرار المحتوى عندما تفتح الصفحة بروابط مختلفة (فلاتر، تتبع).",
          en: "A canonical link prevents duplicate content when the page opens under different URLs (filters, tracking)."
        }
      )
    );
  } else {
    let canonicalHost: string | null = null;
    try {
      canonicalHost = new URL(scan.canonical, url).hostname;
    } catch {
      canonicalHost = null;
    }
    if (!canonicalHost || !sameSite(canonicalHost, new URL(url).hostname)) {
      out.push(
        issue(
          "canonical_offsite",
          "warning",
          url,
          { ar: "رابط canonical يشير إلى موقع آخر", en: "The canonical link points to another site" },
          {
            ar: "عندها ستنسب جوجل الصفحة إلى ذلك الموقع بدلاً من متجرك.",
            en: "Google will then credit that site instead of your store."
          },
          scan.canonical.slice(0, 300)
        )
      );
    }
  }

  if (!scan.htmlLang) {
    out.push(
      issue(
        "lang_missing",
        "warning",
        url,
        { ar: "لغة الصفحة غير محددة (html lang)", en: "The page language is not declared (<html lang>)" },
        {
          ar: 'أضف lang="ar" (أو ar-SA) ليعرف جوجل أن المحتوى عربي ويعرضه للمستخدمين في المملكة.',
          en: 'Add lang="ar" (or ar-SA) so Google knows the content is Arabic and serves it to Saudi users.'
        }
      )
    );
  } else if (/^ar\b/i.test(scan.htmlLang) && scan.htmlDir !== "rtl" && scan.bodyDir !== "rtl") {
    out.push(
      issue(
        "dir_missing",
        "info",
        url,
        { ar: 'الصفحة عربية بلا dir="rtl"', en: 'Arabic page without dir="rtl"' },
        {
          ar: 'أضف dir="rtl" إلى وسم html لعرض النص العربي بالاتجاه الصحيح.',
          en: 'Add dir="rtl" to <html> so Arabic text renders right-to-left.'
        },
        scan.htmlLang
      )
    );
  }

  if (!scan.metaViewport) {
    out.push(
      issue(
        "viewport_missing",
        "warning",
        url,
        { ar: "وسم viewport مفقود", en: "No viewport meta tag" },
        {
          ar: "بدونه لا تظهر الصفحة بشكل صحيح على الجوال، وجوجل تفهرس نسخة الجوال أولاً.",
          en: "Without it the page does not fit phones, and Google indexes the mobile version first."
        }
      )
    );
  }

  if (scan.jsonLdInvalid > 0) {
    out.push(
      issue(
        "jsonld_invalid",
        "warning",
        url,
        { ar: "بيانات منظمة (JSON-LD) غير صالحة", en: "Invalid structured data (JSON-LD)" },
        {
          ar: `${scan.jsonLdInvalid} من كتل JSON-LD لا يمكن قراءتها، فتتجاهلها جوجل.`,
          en: `${scan.jsonLdInvalid} JSON-LD block(s) could not be parsed, so Google ignores them.`
        }
      )
    );
  }
  if (kind === "product" && !scan.jsonLdTypes.includes("Product")) {
    out.push(
      issue(
        "jsonld_product_missing",
        "warning",
        url,
        { ar: "لا توجد بيانات منتج منظمة (Product schema)", en: "No Product structured data" },
        {
          ar: "بيانات Product (السعر، التوفر، التقييم) تتيح لجوجل عرض المنتج بنتائج غنية.",
          en: "Product data (price, availability, rating) lets Google show the product as a rich result."
        }
      )
    );
  }
  if (kind === "home" && !scan.jsonLdTypes.some((t) => SITE_SCHEMA_TYPES.has(t))) {
    out.push(
      issue(
        "jsonld_site_missing",
        "info",
        url,
        { ar: "لا توجد بيانات منظمة للمتجر (Organization / WebSite)", en: "No Organization / WebSite structured data" },
        {
          ar: "تساعد جوجل على عرض اسم متجرك وشعاره ومربع البحث في النتائج.",
          en: "Helps Google show your store name, logo and search box in results."
        }
      )
    );
  }

  if (!scan.ogTitle || !scan.ogImage) {
    out.push(
      issue(
        "og_missing",
        "info",
        url,
        { ar: "وسوم Open Graph ناقصة", en: "Open Graph tags are incomplete" },
        {
          ar: "og:title وog:image تحدد شكل الرابط عند مشاركته في واتساب وسناب وتويتر.",
          en: "og:title and og:image control how the link looks when shared on WhatsApp, Snapchat and X."
        }
      )
    );
  }

  if (page.truncated) {
    out.push(
      issue(
        "page_truncated",
        "info",
        url,
        { ar: "الصفحة كبيرة جداً فدُقّق جزء منها فقط", en: "The page is very large; only the first part was audited" },
        {
          ar: "قد تكون بعض الصور أو العناوين في الجزء الباقي غير مشمولة. صفحة أخف تُحمَّل أسرع أيضاً.",
          en: "Images or headings further down may be missing from the counts. A lighter page also loads faster."
        }
      )
    );
  }

  return out;
}

/** Issue for a page that could not be fetched at all. */
export function fetchFailureIssue(url: string, err: unknown): SeoIssue {
  if (err instanceof OutboundUrlError) {
    return issue(
      "url_refused",
      "critical",
      url,
      { ar: "تعذّر تدقيق هذا الرابط", en: "This URL cannot be audited" },
      {
        ar: "الرابط يجب أن يكون https لموقع عام. تحقّق من رابط المتجر.",
        en: "The URL must be a public https site. Check the store URL."
      },
      err.reason
    );
  }
  if (err instanceof PageFetchError && err.reason === "redirect_offsite") {
    return issue(
      "redirect_offsite",
      "warning",
      url,
      { ar: "الرابط يحوّل إلى موقع آخر", en: "The URL redirects to another site" },
      {
        ar: "حدّث رابط المتجر إلى العنوان النهائي الذي يفتحه الزوار، ثم أعد التدقيق.",
        en: "Update the store URL to the final address visitors land on, then audit again."
      },
      err.target ?? null
    );
  }
  const reason = err instanceof PageFetchError ? err.reason : "network";
  return issue(
    "fetch_failed",
    "critical",
    url,
    { ar: "تعذّر تحميل الصفحة", en: "The page could not be loaded" },
    {
      ar: "لم يستجب المتجر أو انقطع الاتصال. تأكد أن الموقع يعمل ثم أعد المحاولة.",
      en: "The store did not respond or the connection failed. Check the site is up and try again."
    },
    reason
  );
}

/** Up to `max` distinct https product URLs on the store's site (merchant-written data: filtered). */
export function pickProductUrls(storeUrl: string, candidates: Array<string | null | undefined>, max = MAX_PRODUCT_PAGES): string[] {
  let storeHost: string;
  try {
    storeHost = new URL(storeUrl).hostname;
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const raw of candidates) {
    if (out.length >= max) break;
    if (typeof raw !== "string" || raw.length > 2048) continue;
    let u: URL;
    try {
      u = new URL(raw.trim());
    } catch {
      continue;
    }
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") || !sameSite(u.hostname, storeHost)) continue;
    u.hash = "";
    const href = u.toString();
    if (href !== storeUrl && !out.includes(href)) out.push(href);
  }
  return out;
}

export type AuditDeps = {
  fetchPage?: (url: string) => Promise<FetchedPage>;
  now?: () => number;
};

export function sortIssues(issues: SeoIssue[]): SeoIssue[] {
  return [...issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Audit the store home page and up to MAX_PRODUCT_PAGES product pages. Never throws for a page failure. */
export async function runSiteAudit(
  input: { storeUrl: string; productUrls: string[] },
  deps: AuditDeps = {}
): Promise<SiteAuditResult> {
  const fetchPage = deps.fetchPage ?? ((u: string) => fetchPublicPage(u));
  const now = deps.now ?? Date.now;
  const started = now();
  const targets: Array<{ url: string; kind: AuditedPageKind }> = [
    { url: input.storeUrl, kind: "home" },
    ...input.productUrls.slice(0, MAX_PRODUCT_PAGES).map((url) => ({ url, kind: "product" as const }))
  ];

  const pages: AuditedPage[] = [];
  const issues: SeoIssue[] = [];
  for (const target of targets) {
    if (target.kind === "product" && now() - started > AUDIT_BUDGET_MS) break;
    try {
      const page = await fetchPage(target.url);
      const scan = page.status === 200 && page.html !== null ? scanHtml(page.html) : null;
      issues.push(...auditPage(page, target.kind, scan));
      pages.push({ url: target.url, kind: target.kind, final_url: page.finalUrl, status: page.status, ok: page.status === 200 });
    } catch (err) {
      issues.push(fetchFailureIssue(target.url, err));
      pages.push({ url: target.url, kind: target.kind, final_url: null, status: null, ok: false });
      // The home page failing for a guard / redirect reason applies to the whole site.
      if (target.kind === "home" && (err instanceof OutboundUrlError || err instanceof PageFetchError)) break;
    }
  }

  const sorted = sortIssues(issues);
  return {
    url: input.storeUrl,
    audited_at: new Date(now()).toISOString(),
    pages,
    issues: sorted,
    summary: {
      critical: sorted.filter((i) => i.severity === "critical").length,
      warning: sorted.filter((i) => i.severity === "warning").length,
      info: sorted.filter((i) => i.severity === "info").length,
      pages: pages.length
    }
  };
}
