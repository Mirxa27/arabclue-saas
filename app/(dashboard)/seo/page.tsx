"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/dashboard/page-shell";
import { Card, Badge, Empty, Field, Input, Tabs, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { SeoContentPreview } from "@/components/dashboard/seo-content-preview";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { useMerchant } from "@/hooks/use-merchant";
import { normalizeStoreUrl } from "@/lib/seo/store-url";
import type { SeoIssue, SeoIssueSeverity } from "@/lib/seo/audit-types";
import type { SeoContent } from "@/lib/types/database";
import type { SeoOverview } from "@/lib/seo/content";
import type { SeoGenerateResult } from "@/lib/seo/generate";
import type { SeoSiteState, StoredSiteAudit } from "@/lib/seo/site";
import { Search, TrendingUp, AlertTriangle, ExternalLink, RefreshCw, Sparkles, FileText, Save } from "lucide-react";

const SEVERITY: Record<SeoIssueSeverity, { color: string; tone: "danger" | "warn" | "default"; ar: string; en: string }> = {
  critical: { color: "text-danger", tone: "danger", ar: "حرج", en: "critical" },
  warning: { color: "text-accent-warm", tone: "warn", ar: "تحذير", en: "warning" },
  info: { color: "text-accent", tone: "default", ar: "ملاحظة", en: "info" }
};

const DIALECTS = [
  { value: "msa", label: "الفصحى · MSA" },
  { value: "khaliji", label: "خليجي · Khaliji" },
  { value: "english", label: "English · إنجليزي" }
] as const;
type DialectValue = (typeof DIALECTS)[number]["value"];

const TOPIC_MAX = 200;
const KEYWORD_MAX = 80;
const AUDIENCE_MAX = 200;

const errorText = (err: unknown, fallback: string) => (err instanceof ApiClientError ? err.message : fallback);

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }).format(
    new Date(t)
  );
}

function IssueRow({ issue }: { issue: SeoIssue }) {
  const sev = SEVERITY[issue.severity];
  return (
    <li className="p-4 hover:bg-paper-deep/15 transition-colors duration-200">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${sev.color}`}>
          <AlertTriangle size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h4 className="font-arabic text-sm font-medium text-ink leading-snug" dir="rtl">
                {issue.title.ar}
              </h4>
              <p className="text-xs text-ink-soft">{issue.title.en}</p>
            </div>
            <Badge tone={sev.tone} className="shrink-0">
              {sev.ar} · {sev.en}
            </Badge>
          </div>
          <p className="font-arabic text-xs text-ink-mute mt-1.5 leading-relaxed" dir="rtl">
            {issue.detail.ar}
          </p>
          <p className="text-xs text-ink-mute leading-relaxed">{issue.detail.en}</p>
          {issue.evidence && (
            <p className="mt-1.5 text-[11px] font-mono text-ink-soft bg-paper-deep/30 rounded-lg px-2 py-1 whitespace-pre-wrap break-all" dir="auto">
              {issue.evidence}
            </p>
          )}
          <a
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-2 text-[10px] font-mono text-accent hover:underline break-all"
            dir="ltr"
          >
            <ExternalLink size={10} />
            {issue.url}
          </a>
        </div>
      </div>
    </li>
  );
}

export default function SeoPage() {
  const { merchant, loading: merchantLoading, error: merchantError } = useMerchant();
  const { toast } = useToast();

  const [overview, setOverview] = useState<SeoOverview | null>(null);
  const [site, setSite] = useState<SeoSiteState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [urlDraft, setUrlDraft] = useState("");
  const [savingUrl, setSavingUrl] = useState(false);
  const [auditing, setAuditing] = useState(false);

  const [tab, setTab] = useState<"product" | "blog">("product");
  const [productId, setProductId] = useState("");
  const [productDialect, setProductDialect] = useState<DialectValue>("msa");
  const [topic, setTopic] = useState("");
  const [keyword, setKeyword] = useState("");
  const [audience, setAudience] = useState("");
  const [blogDialect, setBlogDialect] = useState<DialectValue>("msa");
  const [generating, setGenerating] = useState(false);

  const [selected, setSelected] = useState<{ item: SeoContent; saved: boolean } | null>(null);

  useEffect(() => {
    if (merchantError) toast(merchantError, "error");
  }, [merchantError, toast]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [ov, st] = await Promise.all([apiFetch<SeoOverview>("/api/seo"), apiFetch<SeoSiteState>("/api/seo/audit")]);
      setOverview(ov);
      setSite(st);
      setUrlDraft(st.store_url ?? "");
      setProductId((current) => current || ov.products[0]?.id || "");
    } catch (err) {
      setLoadError(errorText(err, "تعذّر تحميل بيانات السيو · Could not load SEO data"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (merchantLoading) return;
    if (!merchant) {
      setLoading(false);
      return;
    }
    void load();
  }, [merchant, merchantLoading, load]);

  const audit: StoredSiteAudit | null = site?.audit ?? null;
  const urlCheck = useMemo(() => (urlDraft.trim() ? normalizeStoreUrl(urlDraft) : null), [urlDraft]);
  const urlChanged = Boolean(urlCheck?.ok && urlCheck.url !== (site?.store_url ?? ""));
  const canGenerate = Boolean(overview?.entitled && overview.agent_enabled);
  const quotaLeft = overview ? Math.max(0, overview.usage.limit - overview.usage.used) : 0;

  async function saveUrl() {
    if (!urlCheck?.ok) {
      if (urlCheck && !urlCheck.ok) toast(`${urlCheck.message.ar} · ${urlCheck.message.en}`, "error");
      return;
    }
    setSavingUrl(true);
    try {
      const res = await apiFetch<{ store_url: string }>("/api/seo/site", {
        method: "PUT",
        body: JSON.stringify({ store_url: urlCheck.url })
      });
      setSite((s) => ({ store_url: res.store_url, audit: s?.audit ?? null }));
      setUrlDraft(res.store_url);
      toast("تم حفظ رابط المتجر · Store URL saved", "success");
    } catch (err) {
      toast(errorText(err, "تعذّر حفظ الرابط · Could not save the URL"), "error");
    } finally {
      setSavingUrl(false);
    }
  }

  async function runAudit() {
    setAuditing(true);
    try {
      const res = await apiFetch<{ audit: StoredSiteAudit }>("/api/seo/audit", { method: "POST" });
      setSite((s) => ({ store_url: s?.store_url ?? res.audit.url, audit: res.audit }));
      const { critical, warning, info } = res.audit.summary;
      toast(
        res.audit.saved
          ? `اكتمل التدقيق · Audit complete — ${critical} critical, ${warning} warnings, ${info} notes`
          : "اكتمل التدقيق لكن لم يُحفظ · Audit complete but could not be saved",
        res.audit.saved ? "success" : "error"
      );
    } catch (err) {
      toast(errorText(err, "تعذّر تشغيل التدقيق · The audit could not run"), "error");
    } finally {
      setAuditing(false);
    }
  }

  async function generate() {
    const body =
      tab === "product"
        ? { kind: "product" as const, productId, dialect: productDialect }
        : {
            kind: "blog" as const,
            topic: topic.trim(),
            primaryKeyword: keyword.trim(),
            ...(audience.trim() ? { audience: audience.trim() } : {}),
            dialect: blogDialect
          };
    setGenerating(true);
    try {
      const res = await apiFetch<SeoGenerateResult>("/api/seo/generate", { method: "POST", body: JSON.stringify(body) });
      setOverview((ov) =>
        ov
          ? {
              ...ov,
              usage: res.usage,
              items: res.saved ? [res.item, ...ov.items].slice(0, 50) : ov.items
            }
          : ov
      );
      if (res.saved) {
        setSelected({ item: res.item, saved: true });
        toast("تم توليد المحتوى وحفظه · Content generated and saved", "success");
      } else {
        const payload = (res.copy ?? res.post ?? {}) as SeoContent["payload"];
        setSelected({
          item: {
            id: "unsaved",
            merchant_id: merchant?.id ?? "",
            kind: body.kind,
            ref_id: body.kind === "product" ? body.productId : null,
            payload,
            published: false,
            created_at: new Date().toISOString()
          },
          saved: false
        });
        toast(res.error, "error");
      }
    } catch (err) {
      toast(errorText(err, "تعذّر التوليد · Generation failed"), "error");
    } finally {
      setGenerating(false);
    }
  }

  async function deleteItem(id: string) {
    try {
      await apiFetch(`/api/seo/${id}`, { method: "DELETE" });
      setOverview((ov) => (ov ? { ...ov, items: ov.items.filter((i) => i.id !== id) } : ov));
      toast("تم الحذف · Deleted", "success");
    } catch (err) {
      toast(errorText(err, "تعذّر الحذف · Delete failed"), "error");
      throw err;
    }
  }

  const blogReady = topic.trim().length >= 3 && keyword.trim().length >= 2;
  const generateDisabled =
    generating || !canGenerate || quotaLeft === 0 || (tab === "product" ? !productId : !blogReady);

  return (
    <PageShell title="SEO Insights" merchant={merchant}>
      {loading ? (
        <div className="p-8 text-sm text-ink-mute text-center">جارٍ التحميل… · Loading SEO data…</div>
      ) : !merchant ? (
        <Empty
          title="أكمل إعداد متجرك · Finish setting up your store"
          hint="SEO tools need a store profile first."
          action={
            <Link href="/welcome">
              <Button size="sm">Continue onboarding</Button>
            </Link>
          }
        />
      ) : loadError ? (
        <div className="p-8 text-center" role="alert">
          <p className="text-sm text-danger">{loadError}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>
            إعادة المحاولة · Retry
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary bar — only measured values */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { ar: "مشكلات التدقيق", en: "Audit issues", value: audit ? String(audit.issues.length) : "—" },
              { ar: "مشكلات حرجة", en: "Critical", value: audit ? String(audit.summary.critical) : "—" },
              { ar: "آخر تدقيق", en: "Last audit", value: audit ? formatDate(audit.audited_at) : "—" },
              {
                ar: "توليدات هذا الشهر",
                en: "Generations this month",
                value: overview ? `${overview.usage.used} / ${overview.usage.limit}` : "—"
              }
            ].map((s) => (
              <div key={s.en} className="p-4 rounded-2xl bg-paper-deep/20 border border-rule/30">
                <div className="font-arabic text-[11px] text-ink-soft" dir="rtl">{s.ar}</div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-ink-mute">{s.en}</div>
                <div className="mt-1.5 text-xl font-semibold nums text-ink">{s.value}</div>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Site audit */}
            <Card className="lg:col-span-2 p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-rule/30 flex items-center gap-3">
                <Search size={18} strokeWidth={2} className="text-accent" />
                <h2 className="text-base font-semibold text-ink">
                  <span className="font-arabic" dir="rtl">تدقيق المتجر</span> · Site audit
                </h2>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={runAudit}
                  disabled={auditing || !site?.store_url || urlChanged || !overview?.entitled}
                  className="ml-auto"
                >
                  <RefreshCw size={14} className={auditing ? "animate-spin" : ""} />
                  {auditing ? "Auditing…" : audit ? "Re-run" : "Run"}
                </Button>
              </div>

              <div className="p-4 border-b border-rule/20 space-y-2">
                <Field
                  label="رابط المتجر · Store URL"
                  hint="The public https address of your storefront, e.g. https://salla.sa/your-store or your own domain. The audit checks this page and up to 3 synced product pages on the same site."
                >
                  <div className="flex gap-2">
                    <Input
                      dir="ltr"
                      inputMode="url"
                      autoComplete="url"
                      maxLength={2048}
                      value={urlDraft}
                      onChange={(e) => setUrlDraft(e.target.value)}
                      placeholder="https://"
                      aria-invalid={Boolean(urlCheck && !urlCheck.ok)}
                    />
                    <Button size="sm" variant="outline" onClick={saveUrl} disabled={savingUrl || !urlChanged}>
                      <Save size={14} />
                      {savingUrl ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </Field>
                {urlCheck && !urlCheck.ok && (
                  <p className="text-[11px] text-danger" role="alert">
                    <span className="font-arabic" dir="rtl">{urlCheck.message.ar}</span> · {urlCheck.message.en}
                  </p>
                )}
                {!overview?.entitled && (
                  <p className="text-[11px] text-ink-mute">
                    <span className="font-arabic" dir="rtl">التدقيق متاح في باقتي بلس وبرو.</span> Site audits are included in Plus and Pro.{" "}
                    <Link href="/billing" className="text-accent hover:underline">
                      Upgrade
                    </Link>
                  </p>
                )}
              </div>

              {!site?.store_url ? (
                <div className="p-10 text-center">
                  <Empty
                    title="أضف رابط متجرك · Add your store URL"
                    hint="Save your storefront address above to run a real audit of its title, description, headings, image alt text, canonical and language tags."
                  />
                </div>
              ) : !audit ? (
                <div className="p-10 text-center">
                  <Empty
                    title="لا يوجد تدقيق بعد · No audit yet"
                    hint="Run an audit to fetch your store and list the technical SEO issues found on it."
                    action={
                      <Button onClick={runAudit} disabled={auditing || urlChanged || !overview?.entitled}>
                        <RefreshCw size={14} className={auditing ? "animate-spin" : ""} />
                        {auditing ? "Auditing…" : "Start audit · ابدأ التدقيق"}
                      </Button>
                    }
                  />
                </div>
              ) : (
                <div>
                  <div className="px-4 py-2 text-[11px] text-ink-mute flex flex-wrap gap-x-4 gap-y-1 border-b border-rule/20">
                    <span>
                      {audit.pages.length} page{audit.pages.length === 1 ? "" : "s"} audited · {formatDate(audit.audited_at)}
                    </span>
                    {audit.pages.map((p) => (
                      <span key={p.url} className="font-mono" dir="ltr">
                        {p.kind === "home" ? "home" : "product"}: {p.status ?? "failed"}
                      </span>
                    ))}
                  </div>
                  {audit.issues.length === 0 ? (
                    <div className="p-10 text-center">
                      <Empty
                        title="لا توجد مشكلات · No issues found"
                        hint="Every check passed on the pages audited."
                      />
                    </div>
                  ) : (
                    <ul className="divide-y divide-rule/20 max-h-[560px] overflow-y-auto">
                      {audit.issues.map((issue, i) => (
                        <IssueRow key={`${issue.code}-${issue.url}-${i}`} issue={issue} />
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Card>

            {/* Keyword rankings — no data source yet: say so, never estimate */}
            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-rule/30 flex items-center gap-3">
                <TrendingUp size={18} strokeWidth={2} className="text-accent" />
                <h2 className="text-base font-semibold text-ink">
                  <span className="font-arabic" dir="rtl">ترتيب الكلمات</span> · Keyword rankings
                </h2>
              </div>
              <div className="p-6 space-y-2 text-center">
                <p className="font-arabic text-sm text-ink" dir="rtl">
                  تتبّع الترتيب يحتاج ربط Google Search Console، وهو غير متاح في arabclue بعد.
                </p>
                <p className="text-xs text-ink-mute leading-relaxed">
                  Rank tracking needs a connected Google Search Console property, which arabclue does not support yet. No
                  positions are shown until real data is available — we never estimate rankings.
                </p>
              </div>
            </Card>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Generator */}
            <Card className="lg:col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <Sparkles size={18} className="text-accent-warm" />
                <h2 className="text-base font-semibold text-ink">
                  <span className="font-arabic" dir="rtl">توليد محتوى السيو</span> · Generate SEO copy
                </h2>
                {overview && (
                  <span className="ml-auto text-[11px] font-mono text-ink-mute">
                    {quotaLeft} left this month
                  </span>
                )}
              </div>

              {!overview?.agent_enabled ? (
                <p className="text-sm text-ink-mute" role="status">
                  <span className="font-arabic block" dir="rtl">وكيل السيو متوقف مؤقتاً من إدارة المنصة.</span>
                  The SEO agent is temporarily switched off by the platform admin.
                </p>
              ) : !overview.entitled ? (
                <p className="text-sm text-ink-mute">
                  <span className="font-arabic block" dir="rtl">كتابة محتوى السيو متاحة في باقتي بلس وبرو باشتراك نشط.</span>
                  Arabic SEO copy is included in Plus and Pro with an active subscription.{" "}
                  <Link href="/billing" className="text-accent hover:underline">
                    View plans
                  </Link>
                </p>
              ) : (
                <div className="space-y-4">
                  <Tabs
                    tabs={[
                      { id: "product", label: "وصف منتج · Product" },
                      { id: "blog", label: "مقال · Blog" }
                    ]}
                    activeTab={tab}
                    onChange={(id) => setTab(id === "blog" ? "blog" : "product")}
                  />
                  {tab === "product" ? (
                    overview.products.length === 0 ? (
                      <p className="text-sm text-ink-mute">
                        <span className="font-arabic block" dir="rtl">لا توجد منتجات متزامنة بعد. اربط سلة وزامن منتجاتك أولاً.</span>
                        No synced products yet. Connect Salla and sync your products first.{" "}
                        <Link href="/integrations" className="text-accent hover:underline">
                          Integrations
                        </Link>
                      </p>
                    ) : (
                      <div className="grid sm:grid-cols-2 gap-4">
                        <Field label="المنتج · Product">
                          <select
                            className="w-full h-11 px-4 rounded-xl bg-paper-deep/20 border border-rule/40 text-sm text-ink focus:outline-none focus:border-accent/40"
                            value={productId}
                            onChange={(e) => setProductId(e.target.value)}
                            dir="auto"
                          >
                            {overview.products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="اللغة · Language">
                          <select
                            className="w-full h-11 px-4 rounded-xl bg-paper-deep/20 border border-rule/40 text-sm text-ink focus:outline-none focus:border-accent/40"
                            value={productDialect}
                            onChange={(e) => setProductDialect(e.target.value as DialectValue)}
                          >
                            {DIALECTS.map((d) => (
                              <option key={d.value} value={d.value}>
                                {d.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                    )
                  ) : (
                    <div className="grid gap-4">
                      <Field label="الموضوع · Topic" hint={`${topic.length}/${TOPIC_MAX}`}>
                        <Input dir="auto" maxLength={TOPIC_MAX} value={topic} onChange={(e) => setTopic(e.target.value)} />
                      </Field>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <Field label="الكلمة المفتاحية · Primary keyword" hint={`${keyword.length}/${KEYWORD_MAX}`}>
                          <Input dir="auto" maxLength={KEYWORD_MAX} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
                        </Field>
                        <Field label="اللغة · Language">
                          <select
                            className="w-full h-11 px-4 rounded-xl bg-paper-deep/20 border border-rule/40 text-sm text-ink focus:outline-none focus:border-accent/40"
                            value={blogDialect}
                            onChange={(e) => setBlogDialect(e.target.value as DialectValue)}
                          >
                            {DIALECTS.map((d) => (
                              <option key={d.value} value={d.value}>
                                {d.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <Field label="الجمهور (اختياري) · Audience (optional)" hint={`${audience.length}/${AUDIENCE_MAX}`}>
                        <Textarea dir="auto" rows={2} maxLength={AUDIENCE_MAX} value={audience} onChange={(e) => setAudience(e.target.value)} />
                      </Field>
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-3">
                    {quotaLeft === 0 && (
                      <span className="text-[11px] text-danger">
                        <span className="font-arabic" dir="rtl">انتهى رصيد هذا الشهر</span> · Monthly limit reached
                      </span>
                    )}
                    <Button onClick={generate} disabled={generateDisabled}>
                      <Sparkles size={14} />
                      {generating ? "جارٍ التوليد… · Generating…" : "توليد · Generate"}
                    </Button>
                  </div>
                </div>
              )}
            </Card>

            {/* Generated content */}
            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-rule/30 flex items-center gap-3">
                <FileText size={18} strokeWidth={2} className="text-accent" />
                <h2 className="text-base font-semibold text-ink">
                  <span className="font-arabic" dir="rtl">المحتوى المولَّد</span> · Generated
                </h2>
                <Badge className="ml-auto">{overview?.items.length ?? 0}</Badge>
              </div>
              {!overview || overview.items.length === 0 ? (
                <div className="p-8 text-center">
                  <Empty title="لا يوجد محتوى بعد · Nothing generated yet" hint="Generated product copy and articles appear here." />
                </div>
              ) : (
                <ul className="divide-y divide-rule/20 max-h-[480px] overflow-y-auto">
                  {overview.items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setSelected({ item, saved: true })}
                        className="w-full text-left px-4 py-3 hover:bg-paper-deep/20 transition-colors"
                      >
                        <span className="block text-sm text-ink truncate" dir="auto">
                          {item.payload?.title ?? item.ref_id ?? "—"}
                        </span>
                        <span className="block text-[10px] font-mono text-ink-mute mt-0.5">
                          {item.kind === "blog" ? "مقال · blog" : "منتج · product"} · {formatDate(item.created_at)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      <SeoContentPreview
        item={selected?.item ?? null}
        canDelete={selected?.saved ?? false}
        onClose={() => setSelected(null)}
        onDelete={deleteItem}
      />
    </PageShell>
  );
}
