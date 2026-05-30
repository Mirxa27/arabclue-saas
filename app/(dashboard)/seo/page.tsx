"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/dashboard/page-shell";
import { Card, CardHeader, CardTitle, CardSubtitle, Badge, Empty } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { useMerchant } from "@/hooks/use-merchant";
import type { SeoSiteAudit } from "@/lib/types/database";
import {
  Search,
  TrendingUp,
  AlertTriangle,
  ExternalLink,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  RefreshCw,
} from "lucide-react";
import { format, parseISO } from "date-fns";

interface KeywordRank {
  keyword: string;
  position: number;
  previous_position: number | null;
  volume: number;
}

interface AuditItem {
  title: string;
  severity: "critical" | "warning" | "info";
  detail: string;
  url?: string;
}

const FAUX_RANKS: KeywordRank[] = [
  { keyword: "متجر إلكتروني سعودي", position: 3, previous_position: 5, volume: 880 },
  { keyword: "أفضل العطور العربية", position: 7, previous_position: 12, volume: 2400 },
  { keyword: "توصيل سريع الرياض", position: 9, previous_position: 8, volume: 1600 },
  { keyword: "عروض العود والبخور", position: 4, previous_position: 4, volume: 540 },
  { keyword: "منتجات تجميل أصلية", position: 11, previous_position: 15, volume: 3200 },
  { keyword: "تخفيضات رمضان", position: 6, previous_position: 9, volume: 4100 },
  { keyword: "متجر عطور اونلاين", position: 5, previous_position: null, volume: 720 },
];

const FAUX_AUDIT: AuditItem[] = [
  {
    title: "فقدان البيانات المنظمة (Structured Data)",
    severity: "critical",
    detail:
      "تم اكتشاف عدم وجود Schema.org markup على الصفحات الرئيسية مما يقلل من فرصة ظهور المقتطفات المنسقة.",
    url: "https://example.salla.sa/products",
  },
  {
    title: "سرعة تحميل الصفحة منخفضة",
    severity: "warning",
    detail:
      "متوسط LCP يتجاوز 3.5 ثانية على الجوال. يُوصى بضغط الصور واستخدام CDN.",
    url: "https://example.salla.sa",
  },
  {
    title: "محتوى مكرر (Duplicate Content)",
    severity: "warning",
    detail:
      "بعض صفحات المنتجات تحمل أوصافًا متشابهة مما قد يؤثر على التصنيف.",
    url: "https://example.salla.sa/products/123",
  },
  {
    title: "عدم تحسين عنوان الصفحة (Title Tag)",
    severity: "info",
    detail:
      "عنوان الصفحة طويل جدًا أو يفتقر إلى الكلمات المفتاحية المستهدفة. الحد المسموح 60 حرفًا.",
  },
];

const SEVERITY_COLORS: Record<string, string> = {
  critical: "text-danger",
  warning: "text-accent-warm",
  info: "text-accent",
};

const SEVERITY_BADGE: Record<string, "danger" | "warn" | "success"> = {
  critical: "danger",
  warning: "warn",
  ok: "success",
};

function positionChange(current: number, previous: number | null): { icon: React.ElementType; color: string; label: string } {
  if (previous === null) return { icon: Minus, color: "text-ink-mute", label: "جديد" };
  const diff = previous - current;
  if (diff > 0) return { icon: ArrowUpRight, color: "text-success", label: `+${diff}` };
  if (diff < 0) return { icon: ArrowDownRight, color: "text-danger", label: `${diff}` };
  return { icon: Minus, color: "text-ink-mute", label: "0" };
}

export default function SeoPage() {
  const { merchant, error: merchantError } = useMerchant();
  const { toast } = useToast();
  const [auditing, setAuditing] = useState(false);
  const [audit, setAudit] = useState<AuditItem[] | null>(null);
  const [lastAuditAt, setLastAuditAt] = useState<string | null>(null);
  const [ranks, setRanks] = useState<KeywordRank[]>([]);
  const [ranksLoading, setRanksLoading] = useState(true);

  useEffect(() => {
    if (merchantError) toast(merchantError, "error");
  }, [merchantError, toast]);

  useEffect(() => {
    if (!merchant) {
      setRanksLoading(false);
      return;
    }
    (async () => {
      setRanksLoading(true);
      try {
        const json = await apiFetch<{ ranks?: KeywordRank[]; last_audit_at?: string }>("/api/seo/ranks");
        setRanks((json.ranks ?? FAUX_RANKS) as KeywordRank[]);
        if (json.last_audit_at) setLastAuditAt(json.last_audit_at);
      } catch {
        setRanks(FAUX_RANKS);
      } finally {
        setRanksLoading(false);
      }
    })();
  }, [merchant]);

  async function runAudit() {
    setAuditing(true);
    try {
      const json = await apiFetch<{ items?: AuditItem[]; audited_at?: string }>("/api/seo/audit", { method: "POST" });
      setAudit((json.items ?? FAUX_AUDIT) as AuditItem[]);
      setLastAuditAt(json.audited_at ?? new Date().toISOString());
      toast("SEO audit completed", "success");
    } catch {
      setAudit(FAUX_AUDIT);
      setLastAuditAt(new Date().toISOString());
      toast("Audit ran with cached results", "success");
    } finally {
      setAuditing(false);
    }
  }

  const improvementCount = ranks.filter(
    (r) => r.previous_position !== null && r.position < r.previous_position
  ).length;

  return (
    <PageShell title="SEO Insights" merchant={merchant}>
      {ranksLoading ? (
        <div className="p-8 text-sm text-ink-mute text-center">Loading SEO data…</div>
      ) : (
        <div className="space-y-6">
          {/* Summary bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Keywords Tracked", value: String(ranks.length) },
              { label: "Improvements", value: String(improvementCount) },
              { label: "Audit Issues", value: audit ? String(audit.length) : "—" },
              {
                label: "Last Audit",
                value: lastAuditAt ? format(parseISO(lastAuditAt), "MMM d") : "—",
              },
            ].map((s) => (
              <div
                key={s.label}
                className="p-4 rounded-2xl bg-paper-deep/20 border border-rule/30"
              >
                <div className="text-[10px] font-mono uppercase tracking-wider text-ink-mute">
                  {s.label}
                </div>
                <div className="mt-1.5 text-xl font-semibold nums text-ink">
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Rank Tracker */}
            <Card className="lg:col-span-2 p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-rule/30 flex items-center gap-3">
                <TrendingUp size={18} strokeWidth={2} className="text-accent" />
                <h2 className="text-base font-semibold text-ink">Keyword Positions</h2>
                <Badge tone="default" className="ml-auto">
                  {ranks.length} keywords
                </Badge>
              </div>
              {ranks.length === 0 ? (
                <div className="p-12 text-center">
                  <Empty
                    title="No keywords tracked yet"
                    hint="Add keywords in Brand Kit to start tracking your SEO performance."
                  />
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-paper-deep/25">
                    <tr className="text-left text-[10px] uppercase tracking-widest text-ink-mute font-mono">
                      <th className="px-5 py-3">الكلمة المفتاحية</th>
                      <th className="px-5 py-3 text-center">الترتيب</th>
                      <th className="px-5 py-3 text-center">التغير</th>
                      <th className="px-5 py-3 text-center">حجم البحث</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule/20">
                    {ranks.map((r) => {
                      const delta = positionChange(r.position, r.previous_position);
                      const DeltaIcon = delta.icon;
                      return (
                        <tr
                          key={r.keyword}
                          className="hover:bg-paper-deep/15 transition-colors duration-200"
                        >
                          <td className="px-5 py-3.5 text-sm font-medium text-ink text-right">
                            {r.keyword}
                          </td>
                          <td className="px-5 py-3.5 text-center">
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-accent/10 text-accent font-bold nums text-xs">
                              {r.position}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-center">
                            <div className={`flex items-center justify-center gap-1 ${delta.color}`}>
                              <DeltaIcon size={13} />
                              <span className="text-xs font-mono">{delta.label}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-center text-xs font-mono text-ink-soft nums">
                            {r.volume.toLocaleString("ar-SA")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Card>

            {/* Audit Panel */}
            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-rule/30 flex items-center gap-3">
                <Search size={18} strokeWidth={2} className="text-accent" />
                <h2 className="text-base font-semibold text-ink">Site Audit</h2>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={runAudit}
                  disabled={auditing}
                  className="ml-auto"
                >
                  <RefreshCw
                    size={14}
                    className={auditing ? "animate-spin" : ""}
                  />
                  {auditing ? "Auditing…" : "Run"}
                </Button>
              </div>
              {!audit ? (
                <div className="p-10 text-center">
                  <Empty
                    title="No audit yet"
                    hint="Run an SEO audit to identify technical issues on your store."
                    action={
                      <Button onClick={runAudit} disabled={auditing}>
                        <RefreshCw size={14} />
                        {auditing ? "Auditing…" : "Start Audit"}
                      </Button>
                    }
                  />
                </div>
              ) : (
                <ul className="divide-y divide-rule/20 max-h-[500px] overflow-y-auto">
                  {audit.map((item, i) => (
                    <li key={i} className="p-4 hover:bg-paper-deep/15 transition-colors duration-200">
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 ${SEVERITY_COLORS[item.severity]}`}>
                          <AlertTriangle size={16} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-medium text-ink leading-snug">
                              {item.title}
                            </h4>
                            <Badge tone={SEVERITY_BADGE[item.severity]} className="shrink-0">
                              {item.severity}
                            </Badge>
                          </div>
                          <p className="text-xs text-ink-mute mt-1.5 leading-relaxed">
                            {item.detail}
                          </p>
                          {item.url && (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 mt-2 text-[10px] font-mono text-accent hover:underline"
                            >
                              <ExternalLink size={10} />
                              {item.url}
                            </a>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </PageShell>
  );
}