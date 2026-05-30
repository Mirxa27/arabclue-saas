import { PageShell } from "@/components/dashboard/page-shell";
import { Card, Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { getCurrentMerchant } from "@/lib/auth/session";
import { EMPLOYEE_CATALOG, CATEGORIES, formatPriceSAR } from "@/lib/employees/catalog";
import { getServerSupabase } from "@/lib/db/supabase";
import Link from "next/link";
import { ArrowUpRight, Sparkles, MessageCircle, Send, Star, Clock } from "lucide-react";
import { MarketplaceFilters } from "@/components/marketplace/filters";

export const dynamic = "force-dynamic";

type SearchParams = { q?: string; category?: string };

export default async function MarketplacePage({ searchParams }: { searchParams: SearchParams }) {
  const merchant = await getCurrentMerchant();
  const sb = getServerSupabase();
  const { data: hiredRows } = merchant
    ? await sb.from("ai_employees").select("role_id").eq("merchant_id", merchant.id)
    : { data: [] };
  const hiredRoleCounts = ((hiredRows ?? []) as Array<{ role_id: string }>).reduce<Record<string, number>>(
    (acc, r) => {
      acc[r.role_id] = (acc[r.role_id] ?? 0) + 1;
      return acc;
    },
    {}
  );

  const q = (searchParams.q ?? "").toLowerCase().trim();
  const category = searchParams.category ?? "all";

  const filtered = EMPLOYEE_CATALOG.filter((r) => {
    if (category !== "all" && r.category !== category) return false;
    if (!q) return true;
    return (
      r.name.toLowerCase().includes(q) ||
      r.arabicName.includes(q) ||
      r.tagline.toLowerCase().includes(q) ||
      r.responsibilities.some((s) => s.toLowerCase().includes(q)) ||
      r.skills.some((s) => s.toLowerCase().includes(q))
    );
  });

  return (
    <PageShell title="Hire AI Employees" merchant={merchant}>
      <div className="space-y-8">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-3xl border border-rule/40 bg-gradient-to-br from-accent/[0.08] via-paper to-paper-deep/30 p-6 md:p-10">
          <div className="absolute -right-10 -top-10 w-64 h-64 rounded-full bg-accent/10 blur-3xl pointer-events-none" />
          <div className="relative max-w-3xl">
            <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-accent bg-accent/10 px-3 py-1.5 rounded-full">
              <Sparkles size={12} /> The arabclue team
            </div>
            <h1 className="mt-4 font-display text-3xl md:text-5xl tracking-tight text-ink">
              Hire your next teammate.
              <span className="block italic text-accent">From 49 SAR / month.</span>
            </h1>
            <p className="mt-4 text-ink-soft text-base md:text-lg max-w-2xl">
              {EMPLOYEE_CATALOG.length}+ specialist AI employees. They speak WhatsApp and Telegram by default,
              plug into the tools you already use, and work 24/7 in Arabic and English. 7-day trial on every hire.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3 text-xs text-ink-soft">
              <span className="inline-flex items-center gap-1.5"><MessageCircle size={14} className="text-emerald-600"/> WhatsApp + Telegram included</span>
              <span className="inline-flex items-center gap-1.5"><Clock size={14} className="text-accent"/> Works 24/7</span>
              <span className="inline-flex items-center gap-1.5"><Star size={14} className="text-accent-warm"/> Khaliji-tuned</span>
            </div>
          </div>
        </section>

        {/* Filters */}
        <MarketplaceFilters
          initialQuery={searchParams.q ?? ""}
          initialCategory={category}
          categories={CATEGORIES}
        />

        {/* Results */}
        {filtered.length === 0 ? (
          <Card>
            <div className="py-16 text-center">
              <p className="font-display text-2xl text-ink">No teammates match that search.</p>
              <p className="mt-2 text-sm text-ink-soft">Try a different category or clear the filter.</p>
              <Link href="/marketplace" className="inline-block mt-6">
                <Button variant="ghost" size="sm">Reset filters</Button>
              </Link>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((role) => {
              const hired = hiredRoleCounts[role.id] ?? 0;
              return (
                <Card
                  key={role.id}
                  className="group flex flex-col h-full transition-all duration-300 hover:border-accent/40 hover:shadow-glass-lg hover:-translate-y-0.5"
                >
                  {/* Top row: avatar + highlight */}
                  <div className="flex items-start justify-between">
                    <div className="w-14 h-14 rounded-2xl bg-paper-deep/40 border border-rule/40 flex items-center justify-center text-3xl">
                      {role.emoji}
                    </div>
                    {role.highlight && (
                      <Badge tone={role.highlight === "Most hired" ? "success" : "warn"}>
                        {role.highlight}
                      </Badge>
                    )}
                  </div>

                  {/* Identity */}
                  <div className="mt-4">
                    <p className="text-[10px] font-mono uppercase tracking-widest text-ink-mute">
                      {role.category}
                    </p>
                    <h3 className="mt-1 font-display text-xl text-ink leading-tight">{role.name}</h3>
                    <p className="text-xs text-ink-mute font-arabic" dir="rtl">{role.arabicName}</p>
                    <p className="mt-3 text-sm text-ink-soft leading-relaxed line-clamp-3">{role.tagline}</p>
                  </div>

                  {/* Channels strip */}
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {role.channels.slice(0, 5).map((ch) => (
                      <span
                        key={ch}
                        className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded-md bg-paper-deep/40 text-ink-mute border border-rule/30"
                      >
                        {ch === "whatsapp" && <MessageCircle size={10} className="text-emerald-600" />}
                        {ch === "telegram" && <Send size={10} className="text-blue-500" />}
                        {ch}
                      </span>
                    ))}
                    {role.channels.length > 5 && (
                      <span className="text-[10px] font-mono text-ink-mute px-1 py-1">
                        +{role.channels.length - 5} more
                      </span>
                    )}
                  </div>

                  {/* Price + CTA */}
                  <div className="mt-auto pt-5 flex items-end justify-between border-t border-rule/30 mt-4">
                    <div>
                      <p className="text-[10px] font-mono uppercase tracking-widest text-ink-mute">
                        from
                      </p>
                      <p className="font-display text-2xl text-ink nums">
                        {formatPriceSAR(role.starterPriceHalalas)}
                        <span className="text-xs font-mono font-normal text-ink-mute ml-1">SAR/mo</span>
                      </p>
                      {hired > 0 && (
                        <p className="mt-1 text-[10px] font-mono text-accent uppercase tracking-wider">
                          {hired} hired
                        </p>
                      )}
                    </div>
                    <Link href={`/marketplace/${role.slug}`}>
                      <Button size="sm" variant="primary" className="group/cta">
                        Hire
                        <ArrowUpRight size={12} className="transition-transform group-hover/cta:translate-x-0.5 group-hover/cta:-translate-y-0.5" />
                      </Button>
                    </Link>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}
