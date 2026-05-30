import { notFound } from "next/navigation";
import Link from "next/link";
import { PageShell } from "@/components/dashboard/page-shell";
import { Card, Badge } from "@/components/ui/primitives";
import { getCurrentMerchant } from "@/lib/auth/session";
import { getRoleBySlug, EMPLOYEE_CATALOG } from "@/lib/employees/catalog";
import { personasForRole } from "@/lib/employees/personas";
import { HireForm } from "@/components/marketplace/hire-form";
import { PersonaCard } from "@/components/marketplace/persona-card";
import {
  ArrowLeft,
  Check,
  MessageCircle,
  Send,
  Sparkles,
  Target,
  Wrench,
  Lightbulb,
  Clock,
  Shield,
  TrendingUp,
  Users,
} from "lucide-react";

export const dynamic = "force-dynamic";

export async function generateStaticParams() {
  return EMPLOYEE_CATALOG.map((r) => ({ slug: r.slug }));
}

export default async function MarketplaceRolePage({ params }: { params: { slug: string } }) {
  const role = getRoleBySlug(params.slug);
  if (!role) notFound();

  const merchant = await getCurrentMerchant();
  const personas = personasForRole(role.id);

  return (
    <PageShell title={role.name} merchant={merchant}>
      <div className="space-y-8">
        {/* Back */}
        <Link
          href="/marketplace"
          className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-ink-mute hover:text-ink transition-colors"
        >
          <ArrowLeft size={12} /> Back to marketplace
        </Link>

        {/* Hero block */}
        <section className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          <div className="lg:col-span-3">
            <div className="flex items-start gap-5">
              <div className="w-20 h-20 rounded-2xl bg-paper-deep/40 border border-rule/40 flex items-center justify-center text-5xl shrink-0">
                {role.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-ink-mute">
                    {role.category}
                  </p>
                  {role.highlight && (
                    <Badge tone={role.highlight === "Most hired" ? "success" : "warn"}>
                      {role.highlight}
                    </Badge>
                  )}
                </div>
                <h1 className="mt-1 font-display text-3xl md:text-4xl tracking-tight text-ink">
                  {role.name}
                </h1>
                <p className="text-base text-ink-mute font-arabic mt-1" dir="rtl">
                  {role.arabicName}
                </p>
                <p className="mt-4 text-base text-ink-soft leading-relaxed">{role.bio}</p>
              </div>
            </div>

            {/* Responsibilities */}
            <Card className="mt-6">
              <h2 className="font-display text-xl text-ink flex items-center gap-2">
                <Target size={16} className="text-accent" /> Responsibilities
              </h2>
              <ul className="mt-4 space-y-2.5">
                {role.responsibilities.map((r) => (
                  <li key={r} className="flex items-start gap-3 text-sm text-ink-soft">
                    <Check size={14} className="text-accent mt-0.5 shrink-0" strokeWidth={2.5} />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="mt-5">
              <h2 className="font-display text-xl text-ink flex items-center gap-2">
                <Wrench size={16} className="text-ink-soft" /> Skills
              </h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {role.skills.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center px-3 py-1.5 rounded-lg bg-paper-deep/40 border border-rule/30 text-xs text-ink-soft"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </Card>

            <Card className="mt-5">
              <h2 className="font-display text-xl text-ink flex items-center gap-2">
                <TrendingUp size={16} className="text-emerald-600" /> KPIs I track
              </h2>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                {role.kpis.map((k) => (
                  <div
                    key={k}
                    className="p-3 rounded-xl bg-paper-deep/30 border border-rule/30 text-center"
                  >
                    <p className="text-xs font-mono uppercase tracking-wider text-ink-mute">
                      {k.split(/[<>]/)[0].trim() || k}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-ink">{k.match(/[<>].+/)?.[0] ?? "—"}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="mt-5">
              <h2 className="font-display text-xl text-ink flex items-center gap-2">
                <Lightbulb size={16} className="text-accent-warm" /> Tools I use
              </h2>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {role.tools.map((t) => (
                  <div key={t.name} className="p-3 rounded-xl border border-rule/30 bg-paper/40">
                    <p className="text-sm font-medium text-ink">{t.label}</p>
                    <p className="mt-1 text-xs text-ink-mute">{t.description}</p>
                  </div>
                ))}
              </div>
            </Card>

            {personas.length > 0 && (
              <Card className="mt-5">
                <h2 className="font-display text-xl text-ink flex items-center gap-2">
                  <Users size={16} className="text-accent" /> Available personas
                </h2>
                <p className="mt-2 text-xs text-ink-mute">
                  Pick a real-feeling teammate. You can rename and re-tune any time after hiring.
                </p>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {personas.map((p) => (
                    <PersonaCard key={p.id} persona={p} />
                  ))}
                </div>
              </Card>
            )}
          </div>

          {/* Hire panel */}
          <div className="lg:col-span-2">
            <div className="lg:sticky lg:top-6 space-y-5">
              <HireForm role={role} personas={personas} />

              <Card>
                <h3 className="font-display text-lg text-ink flex items-center gap-2">
                  <Sparkles size={14} className="text-accent" /> Out-of-the-box integrations
                </h3>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {role.channels.map((c) => (
                    <span
                      key={c}
                      className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded-md bg-paper-deep/40 text-ink-soft border border-rule/30"
                    >
                      {c === "whatsapp" && <MessageCircle size={10} className="text-emerald-600" />}
                      {c === "telegram" && <Send size={10} className="text-blue-500" />}
                      {c}
                    </span>
                  ))}
                </div>
                <p className="mt-4 text-[10px] font-mono uppercase tracking-widest text-ink-mute">
                  Recommended add-ons
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {role.recommendedIntegrations.map((c) => (
                    <span
                      key={c}
                      className="inline-flex items-center text-[10px] font-mono px-2 py-1 rounded-md bg-accent/5 text-accent border border-accent/20"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </Card>

              <Card variant="flat">
                <h3 className="font-display text-lg text-ink flex items-center gap-2">
                  <Shield size={14} className="text-emerald-600" /> Guarantees
                </h3>
                <ul className="mt-3 space-y-2 text-xs text-ink-soft">
                  <li className="flex items-start gap-2"><Clock size={12} className="text-accent mt-0.5"/> {role.trialDays}-day no-card trial</li>
                  <li className="flex items-start gap-2"><Check size={12} className="text-accent mt-0.5"/> Cancel any time, prorated</li>
                  <li className="flex items-start gap-2"><Check size={12} className="text-accent mt-0.5"/> PDPL-safe — all data stays in your tenant</li>
                  <li className="flex items-start gap-2"><Check size={12} className="text-accent mt-0.5"/> Audit log of every action</li>
                </ul>
              </Card>
            </div>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
