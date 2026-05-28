"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, ChevronDown } from "lucide-react";

type Lang = "en" | "ar";

const copy = {
  en: {
    nav: { product: "Product", pricing: "Pricing", company: "About", login: "Login", cta: "Get Arabclue" },
    hero: {
      kicker: "AR · KSA · GCC",
      title1: "Your",
      titleSerif: "dalīl",
      title2: "for trading",
      title3: "in Arabia.",
      sub: "arabclue is an Arabic-first AI ops layer for Saudi and GCC SMBs. ZATCA-compliant invoicing, agentic social media, Gulf-dialect voice agents, and Arabic SEO — all on the dalīl your business actually follows.",
      cta1: "Install on Salla",
      cta2: "See the dalīl",
      stat1: ["1.7M", "active commercial registrations in KSA, 2025"],
      stat2: ["8.2B", "ZATCA e-invoices processed in 2025"],
      stat3: ["68K+", "Salla merchants — your distribution"]
    },
    section02: {
      kicker: "٠٢ — THE BUILD",
      title: "Four modules. One copilot.",
      sub: "Each Arabclue module replaces a vendor a Saudi SMB is already paying. Bundle once, run everywhere."
    },
    modules: [
      {
        idx: "٠١",
        ar: "فاتورة",
        name: "ZATCA Invoicing",
        body: "Wave 23 / 24 forces every Salla merchant past SAR 375k VAT into Fatoora integration. We stamp every order with QR, UUID, and XML in real time — clean, audited, no plug-ins.",
        deadline: "Wave 24 deadline: 30 June 2026"
      },
      {
        idx: "٠٢",
        ar: "وسائل التواصل",
        name: "Agentic Social Media",
        body: "Planner, writer, designer, scheduler, replier — five agents that run your Instagram, TikTok, X, Snapchat, and LinkedIn in Khaliji Arabic. Pull products from Salla, post on cadence, reply in voice.",
        deadline: "New in Pro tier"
      },
      {
        idx: "٠٣",
        ar: "صوت",
        name: "Gulf-Dialect Voice Agent",
        body: "Your shop's phone, answered 24/7 in Saudi Arabic — bookings, FAQs, order status, escalation. OpenAI Realtime + dialect tuning + PDPL-safe routing.",
        deadline: "Twilio + STC numbers"
      },
      {
        idx: "٠٤",
        ar: "محتوى",
        name: "Arabic SEO & Product Copy",
        body: "Native Arabic product descriptions, meta, and blog content that Google KSA actually ranks. No more machine-translated penalties.",
        deadline: "Per-product or unlimited"
      }
    ],
    socialFeature: {
      kicker: "٠٣ — THE SOCIAL AGENT",
      title: "Five agents. One feed.",
      points: [
        "Planner reads your Salla catalog, Saudi calendar, and brand voice to build a 30-day grid.",
        "Copywriter drafts captions in Khaliji, MSA, or English — your dialect, your shape.",
        "Visualist composes carousel layouts using your product imagery and brand kit.",
        "Scheduler posts to IG, TikTok, X, Snapchat, LinkedIn on cadence — Vercel Cron under the hood.",
        "Engagement agent replies to DMs and comments in Arabic, escalates only when needed."
      ]
    },
    pricing: {
      kicker: "٠٤ — PRICING",
      title: "SAR pricing. Salla billing. No CR required to start.",
      plans: [
        {
          name: "Lite",
          price: "99",
          unit: "SAR / month",
          features: ["ZATCA invoicing", "200 invoices / month", "Arabic dashboard", "Email support"]
        },
        {
          name: "Plus",
          price: "299",
          unit: "SAR / month",
          highlight: true,
          features: [
            "Everything in Lite",
            "Agentic social media (3 platforms)",
            "500 AI voice minutes",
            "100 product descriptions",
            "Priority support"
          ]
        },
        {
          name: "Pro",
          price: "599",
          unit: "SAR / month",
          features: [
            "Everything in Plus",
            "All 5 social platforms",
            "2,000 voice minutes",
            "Unlimited descriptions",
            "WhatsApp Business AI",
            "Wathq B2B enrichment"
          ]
        }
      ]
    },
    footer: {
      tag: "your dalīl for trading in Arabia",
      built: "Built in Riyadh & Jeddah for Vision 2030.",
      cols: {
        product: ["Product", ["Modules", "ZATCA", "Social Agent", "Voice", "Pricing"]],
        company: ["Company", ["About", "Manifesto", "Careers", "Press"]],
        legal: ["Legal", ["PDPL", "Terms", "Privacy", "Maroof"]]
      }
    }
  },
  ar: {
    nav: { product: "المنتج", pricing: "الأسعار", company: "من نحن", login: "تسجيل الدخول", cta: "ابدأ مع أرب كلو" },
    hero: {
      kicker: "العربية · المملكة · الخليج",
      title1: "دليلك",
      titleSerif: "في",
      title2: "التجارة",
      title3: "العربية.",
      sub: "أرب كلو منصة ذكاء اصطناعي عربية تخدم منشآت المملكة والخليج: فوترة زاتكا، إدارة وسائل التواصل بالوكلاء، وكلاء صوتيون باللهجة الخليجية، وSEO عربي — كل ما تحتاجه في دليل واحد.",
      cta1: "ثبّت على سلة",
      cta2: "اعرف الدليل",
      stat1: ["١٫٧ مليون", "سجل تجاري نشط في المملكة، ٢٠٢٥"],
      stat2: ["٨٫٢ مليار", "فاتورة إلكترونية معالجة في زاتكا، ٢٠٢٥"],
      stat3: ["+٦٨ ألف", "تاجر على سلة — قناة توزيعك"]
    },
    section02: {
      kicker: "٠٢ — البناء",
      title: "أربع وحدات. مساعد واحد.",
      sub: "كل وحدة في أرب كلو تستبدل مورّداً تدفع له اليوم. اربط مرة واحدة، شغّل في كل مكان."
    },
    modules: [
      { idx: "٠١", ar: "فاتورة", name: "فوترة زاتكا", body: "موجة ٢٣ و٢٤ تُلزم كل تاجر سلة تجاوزت إيراداته ٣٧٥ ألف ريال بربط فاتورة. نختم كل طلب بـQR و UUID و XML فورياً، نظيف ومدقّق دون إضافات.", deadline: "موعد الموجة ٢٤: ٣٠ يونيو ٢٠٢٦" },
      { idx: "٠٢", ar: "وسائل التواصل", name: "وكلاء التواصل الاجتماعي", body: "مخطّط، كاتب، مصمم، مجدول، ومجيب — خمسة وكلاء يديرون إنستغرام وتيك توك وسناب شات وإكس ولينكدإن بالخليجية. يقرأون كتالوج سلة وينشرون بإيقاع ويردّون بصوتك.", deadline: "ميزة جديدة في باقة برو" },
      { idx: "٠٣", ar: "صوت", name: "وكيل صوتي خليجي", body: "هاتف متجرك يُجيب ٢٤/٧ بالعربية السعودية — حجوزات، أسئلة شائعة، حالة الطلب، تحويل. مبنيّ على OpenAI Realtime مع ضبط لهجة وحماية PDPL.", deadline: "أرقام Twilio و STC" },
      { idx: "٠٤", ar: "محتوى", name: "SEO ووصف منتجات بالعربية", body: "وصف منتجات وميتا ومدونة بعربية أصلية تتصدّر نتائج جوجل في المملكة. وداعاً لعقوبات الترجمة الآلية.", deadline: "للمنتج أو غير محدود" }
    ],
    socialFeature: {
      kicker: "٠٣ — وكلاء التواصل",
      title: "خمسة وكلاء. شبكة واحدة.",
      points: [
        "المخطّط يقرأ كتالوج سلة والرزنامة السعودية وصوت العلامة ليبني جدول ٣٠ يوماً.",
        "الكاتب يصيغ التعليقات بالخليجية أو الفصحى أو الإنجليزية — لهجتك، شكلك.",
        "المصمم يركّب كاروسلات بصور منتجاتك ودليل علامتك.",
        "المجدول ينشر على إنستغرام وتيك توك وإكس وسناب شات ولينكدإن — Vercel Cron تحت الغطاء.",
        "وكيل التفاعل يردّ على الرسائل والتعليقات بالعربية، ويُصعّد فقط عند الضرورة."
      ]
    },
    pricing: {
      kicker: "٠٤ — الأسعار",
      title: "أسعار بالريال. فوترة عبر سلة. لا تحتاج سجلاً تجارياً للبدء.",
      plans: [
        { name: "لايت", price: "٩٩", unit: "ريال / شهر", features: ["فوترة زاتكا", "٢٠٠ فاتورة / شهر", "لوحة عربية", "دعم بالبريد"] },
        { name: "بلس", price: "٢٩٩", unit: "ريال / شهر", highlight: true, features: ["كل ما في لايت", "وكلاء تواصل (٣ منصات)", "٥٠٠ دقيقة صوت", "١٠٠ وصف منتج", "دعم متقدّم"] },
        { name: "برو", price: "٥٩٩", unit: "ريال / شهر", features: ["كل ما في بلس", "كل المنصات الخمس", "٢٠٠٠ دقيقة صوت", "أوصاف غير محدودة", "ذكاء واتساب أعمال", "إثراء B2B من واثق"] }
      ]
    },
    footer: { tag: "دليلك في التجارة العربية", built: "صُنع في الرياض وجدة لرؤية ٢٠٣٠.", cols: { product: ["المنتج", ["الوحدات", "زاتكا", "وكيل التواصل", "الصوت", "الأسعار"]], company: ["الشركة", ["من نحن", "الرؤية", "وظائف", "الإعلام"]], legal: ["القانوني", ["PDPL", "الشروط", "الخصوصية", "معروف"]] } }
  }
} as const;

export default function Page() {
  const [lang, setLang] = useState<Lang>("en");
  const t = copy[lang];
  const isAr = lang === "ar";

  return (
    <main dir={isAr ? "rtl" : "ltr"} className={isAr ? "ar" : ""}>
      {/* NAV */}
      <header className="border-b border-rule">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo />
            <span className="font-display text-[22px] tracking-tightest leading-none">arabclue</span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm">
            <a href="#product" className="hover:text-accent">{t.nav.product}</a>
            <a href="#pricing" className="hover:text-accent">{t.nav.pricing}</a>
            <a href="#about" className="hover:text-accent">{t.nav.company}</a>
            <button
              onClick={() => setLang(lang === "en" ? "ar" : "en")}
              className="font-mono text-xs uppercase tracking-widest border border-ink/15 px-2.5 py-1.5 hover:border-ink/40 transition"
              aria-label="Switch language"
            >
              {lang === "en" ? "ع · AR" : "EN · ع"}
            </button>
            <a href="#install" className="button-primary text-xs">
              {t.nav.cta} <ArrowUpRight size={14} />
            </a>
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 pt-16 pb-24 lg:pt-28 lg:pb-36">
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-16">
            <div className="lg:col-span-8 reveal" style={{ animationDelay: "60ms" }}>
              <div className="marker-numeral mb-8">٠١ — {t.hero.kicker}</div>
              <h1 className="display-1 text-[clamp(3.5rem,8vw,8.5rem)]">
                {isAr ? (
                  <>
                    <span className="arabic-display">{t.hero.title1}</span>
                    <br />
                    <em className="italic text-accent">{t.hero.titleSerif}</em>{" "}
                    <span className="arabic-display">{t.hero.title2}</span>
                    <br />
                    <span className="arabic-display">{t.hero.title3}</span>
                  </>
                ) : (
                  <>
                    {t.hero.title1}
                    <br />
                    <em className="italic text-accent">{t.hero.titleSerif}</em> {t.hero.title2}
                    <br />
                    {t.hero.title3}
                  </>
                )}
              </h1>
              <p className={`mt-10 max-w-readable text-lg leading-relaxed text-ink-soft ${isAr ? "arabic-display" : ""}`}>
                {t.hero.sub}
              </p>
              <div className="mt-10 flex flex-wrap gap-3">
                <a href="#install" className="button-primary">
                  {t.hero.cta1} <ArrowUpRight size={16} />
                </a>
                <a href="#product" className="button-ghost">
                  {t.hero.cta2} <ChevronDown size={16} />
                </a>
              </div>
            </div>

            <aside className="lg:col-span-4 lg:border-s lg:border-rule lg:ps-10 flex flex-col justify-end gap-8 reveal" style={{ animationDelay: "180ms" }}>
              <Stat n={t.hero.stat1[0]} label={t.hero.stat1[1]} isAr={isAr} />
              <div className="rule" />
              <Stat n={t.hero.stat2[0]} label={t.hero.stat2[1]} isAr={isAr} />
              <div className="rule" />
              <Stat n={t.hero.stat3[0]} label={t.hero.stat3[1]} isAr={isAr} />
            </aside>
          </div>
        </div>
        <div className="rule" />
      </section>

      {/* MODULES */}
      <section id="product" className="bg-paper-deep/40">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 py-24 lg:py-32">
          <div className="marker-numeral mb-6">{t.section02.kicker}</div>
          <h2 className={`display-1 text-[clamp(2.5rem,5vw,5rem)] max-w-4xl ${isAr ? "arabic-display" : ""}`}>
            {t.section02.title}
          </h2>
          <p className={`mt-6 max-w-readable text-lg text-ink-soft ${isAr ? "arabic-display" : ""}`}>{t.section02.sub}</p>

          <div className="mt-16 grid md:grid-cols-2 gap-px bg-rule border border-rule">
            {t.modules.map((m) => (
              <article key={m.idx} className="bg-paper p-8 lg:p-10 flex flex-col gap-4 min-h-[280px]">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-sm tracking-widest text-ink-mute">{m.idx}</span>
                  <span className="arabic-display text-accent">{m.ar}</span>
                </div>
                <h3 className={`font-display text-3xl leading-tight tracking-crisp ${isAr ? "arabic-display font-normal" : ""}`}>
                  {m.name}
                </h3>
                <p className={`text-ink-soft text-[15px] leading-relaxed ${isAr ? "arabic-display" : ""}`}>{m.body}</p>
                <div className="mt-auto pt-4 border-t border-rule font-mono text-[11px] uppercase tracking-widest text-accent-warm-deep">
                  {m.deadline}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* SOCIAL AGENT DETAIL */}
      <section className="bg-ink text-paper">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 py-24 lg:py-32 grid lg:grid-cols-12 gap-10">
          <div className="lg:col-span-5">
            <div className="marker-numeral mb-6 text-paper/50">{t.socialFeature.kicker}</div>
            <h2 className={`display-1 text-[clamp(2.25rem,4.5vw,4.25rem)] ${isAr ? "arabic-display" : ""}`}>
              {t.socialFeature.title}
            </h2>
          </div>
          <ol className="lg:col-span-7 lg:border-s lg:border-paper/15 lg:ps-12 space-y-8">
            {t.socialFeature.points.map((p, i) => (
              <li key={i} className="grid grid-cols-[auto_1fr] gap-6 items-start">
                <span className="font-mono text-xs text-paper/50 tracking-widest mt-1.5">{String(i + 1).padStart(2, "0")}</span>
                <span className={`text-lg leading-relaxed text-paper/90 ${isAr ? "arabic-display" : ""}`}>{p}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 py-24 lg:py-32">
          <div className="marker-numeral mb-6">{t.pricing.kicker}</div>
          <h2 className={`display-1 text-[clamp(2.25rem,4.5vw,4.5rem)] max-w-4xl ${isAr ? "arabic-display" : ""}`}>
            {t.pricing.title}
          </h2>

          <div className="mt-16 grid md:grid-cols-3 gap-px bg-rule border border-rule">
            {t.pricing.plans.map((p) => {
              const highlighted = "highlight" in p && Boolean(p.highlight);
              return (
              <div
                key={p.name}
                className={`p-8 lg:p-10 flex flex-col gap-6 ${highlighted ? "bg-ink text-paper" : "bg-paper"}`}
              >
                <h3 className={`font-display text-3xl tracking-crisp ${isAr ? "arabic-display font-normal" : ""}`}>
                  {p.name}
                </h3>
                <div className="flex items-baseline gap-2 nums">
                  <span className="font-display text-6xl tracking-tightest">{p.price}</span>
                  <span className={`text-sm ${highlighted ? "text-paper/60" : "text-ink-mute"} ${isAr ? "arabic-display" : ""}`}>
                    {p.unit}
                  </span>
                </div>
                <ul className="space-y-3 mt-2">
                  {p.features.map((f: string) => (
                    <li key={f} className={`flex items-start gap-2 text-sm leading-snug ${isAr ? "arabic-display" : ""}`}>
                      <Check size={16} className={`mt-0.5 shrink-0 ${highlighted ? "text-paper/80" : "text-accent"}`} />
                      <span className={highlighted ? "text-paper/85" : "text-ink-soft"}>{f}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href="#install"
                  className={`mt-auto inline-flex items-center justify-between border px-5 py-3 text-sm tracking-crisp transition ${
                    highlighted ? "border-paper/30 hover:border-paper text-paper" : "border-ink/15 hover:border-ink/40 text-ink"
                  }`}
                >
                  {isAr ? "اختر هذه الباقة" : "Choose this plan"}
                  <ArrowUpRight size={14} />
                </a>
              </div>
            );
            })}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer id="about" className="bg-paper-deep/50 border-t border-rule">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 py-16">
          <div className="grid lg:grid-cols-12 gap-10">
            <div className="lg:col-span-5">
              <div className="flex items-center gap-2.5">
                <Logo />
                <span className="font-display text-2xl tracking-tightest">arabclue</span>
              </div>
              <p className={`mt-4 text-ink-soft max-w-sm ${isAr ? "arabic-display" : ""}`}>{t.footer.tag}</p>
              <p className={`mt-8 font-mono text-[11px] uppercase tracking-widest text-ink-mute ${isAr ? "font-arabic" : ""}`}>
                {t.footer.built}
              </p>
            </div>
            <div className="lg:col-span-7 grid grid-cols-3 gap-8">
              {(["product", "company", "legal"] as const).map((k) => {
                const cols = t.footer.cols as Record<"product" | "company" | "legal", readonly [string, readonly string[]]>;
                const [title, items] = cols[k];
                return (
                  <div key={k}>
                    <div className={`marker-numeral mb-4 ${isAr ? "font-arabic" : ""}`}>{title}</div>
                    <ul className="space-y-2.5 text-sm">
                      {items.map((it: string) => (
                        <li key={it}><a href="#" className={`text-ink-soft hover:text-ink ${isAr ? "arabic-display" : ""}`}>{it}</a></li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-16 pt-6 border-t border-rule flex flex-wrap items-center justify-between gap-4 text-xs text-ink-mute">
            <span className="font-mono">© ٢٠٢٦ arabclue · all rights reserved</span>
            <span className="font-mono">arabclue.com</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Stat({ n, label, isAr }: { n: string; label: string; isAr: boolean }) {
  return (
    <div>
      <div className="font-display text-5xl tracking-tightest nums leading-none">{n}</div>
      <div className={`mt-2 text-xs uppercase tracking-widest text-ink-mute ${isAr ? "font-arabic normal-case tracking-normal text-sm" : ""}`}>
        {label}
      </div>
    </div>
  );
}

function Logo() {
  // A bespoke mark — a stylized dalīl / pointing arrow + Arabic-feel angled stroke
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
      <rect x="0.5" y="0.5" width="27" height="27" rx="3" stroke="currentColor" strokeOpacity="0.18" />
      <path d="M7 18.5L14 7L21 18.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="14" cy="20.5" r="1.4" fill="currentColor" />
    </svg>
  );
}
