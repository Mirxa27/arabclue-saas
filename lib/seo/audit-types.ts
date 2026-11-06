/**
 * Shapes of the SEO site audit (lib/seo/audit.ts) shared with the client: the
 * POST/GET /api/seo/audit response and the seo_site_audits row payload. Types only.
 */

export type SeoIssueSeverity = "critical" | "warning" | "info";

export type SeoIssueCode =
  | "fetch_failed"
  | "url_refused"
  | "redirect_offsite"
  | "http_status"
  | "not_html"
  | "noindex"
  | "title_missing"
  | "title_too_long"
  | "title_too_short"
  | "title_multiple"
  | "meta_description_missing"
  | "meta_description_length"
  | "h1_missing"
  | "h1_multiple"
  | "img_alt_missing"
  | "canonical_missing"
  | "canonical_offsite"
  | "lang_missing"
  | "dir_missing"
  | "viewport_missing"
  | "jsonld_product_missing"
  | "jsonld_site_missing"
  | "jsonld_invalid"
  | "og_missing"
  | "page_truncated";

export type Bilingual = { ar: string; en: string };

export type SeoIssue = {
  code: SeoIssueCode;
  severity: SeoIssueSeverity;
  /** The audited page the issue was found on. */
  url: string;
  title: Bilingual;
  detail: Bilingual;
  /** Text taken from the page (a title, an image src) — render with dir="auto". */
  evidence?: string | null;
};

export type AuditedPageKind = "home" | "product";

export type AuditedPage = {
  url: string;
  kind: AuditedPageKind;
  final_url: string | null;
  status: number | null;
  ok: boolean;
};

export type SiteAuditResult = {
  url: string;
  audited_at: string;
  pages: AuditedPage[];
  issues: SeoIssue[];
  summary: { critical: number; warning: number; info: number; pages: number };
};
