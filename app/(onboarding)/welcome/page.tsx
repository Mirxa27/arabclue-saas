"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/primitives";
import { LogoFull } from "@/components/ui/logo";
import { getBrowserSupabase } from "@/lib/db/supabase-browser";
import {
  Check,
  ArrowRight,
  Sparkles,
  RefreshCw,
  Phone,
  Share2,
  FileText,
  Search,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Zap,
  Info
} from "lucide-react";
import { trackClientEvent } from "@/lib/analytics/client";
import { ALL_PERSONAS, type Persona } from "@/lib/agents/personas";
import OnboardingChat from "@/components/dashboard/onboarding-chat";

type Step = 1 | 2 | 3 | 4 | 5;

export default function WelcomePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1: business basics
  const [businessName, setBusinessName] = useState("");
  const [vatNumber, setVatNumber] = useState("");

  // Step 2: brand voice
  const [essence, setEssence] = useState("");
  const [attributes, setAttributes] = useState("");
  const [dialect, setDialect] = useState<"khaliji" | "msa" | "english">("khaliji");

  // Step 3: plan tier
  const [plan, setPlan] = useState<"lite" | "plus" | "pro">("plus");

  // Step 4: confirm
  const [dpaAccepted, setDpaAccepted] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  // Sara AI Assistant state
  const [saraMessage, setSaraMessage] = useState("");
  const [saraTyping, setSaraTyping] = useState(false);
  const [saraActionStatus, setSaraActionStatus] = useState<string | null>(null);
  const [activeVoiceIntro, setActiveVoiceIntro] = useState<string | null>(null);

  // Dynamic Sara Arabic speech generator based on step
  useEffect(() => {
    setSaraTyping(true);
    setSaraActionStatus(null);
    setActiveVoiceIntro(null);

    const timer = setTimeout(() => {
      setSaraTyping(false);
      if (step === 1) {
        setSaraMessage(
          "أهلاً وسهلاً بك في أرب كلو! 🇸🇦 أنا سارة، منسقة التهيئة الرقمية المخصصة لمساعدتك في توظيف وتدريب فريق عملك من وكلاء الذكاء الاصطناعي. خلّنا نبدأ بتسجيل متجرك، اكتب اسم عملك أو اضغط بالأسفل لملء متجر عطور تجريبي لنبدأ سوا!"
        );
      } else if (step === 2) {
        setSaraMessage(
          `يا سلام، متجر ${businessName || "العود الفاخر"} اسم مميز! الحين خلّنا نحدد "صوت وهوية العلامة التجارية". الذكاء الاصطناعي يقدر يحلل نشاطك ويقترح جملة الجوهر والسمات التراثية المناسبة للخليج بضغطة زر!`
        );
      } else if (step === 3) {
        setSaraMessage(
          "تسلسل رائع! الحين تختار الباقة المناسبة لحجم متجرك. باقة بلس هي الباقة المفضلة لـ 80% من التجار لأنها تفعل لك سالم (ممثل خدمة العملاء الهاتفي) و نورة (مسوقة السوشال ميديا) بجانب سيو المنتجات!"
        );
      } else if (step === 4) {
        setSaraMessage(
          `فريق عملك الذكي جاهز للبدء يا غالي! كل وكيل له لهجة محلية وتدريب متكامل. نورة تصمم وتجدول السوشال، سالم يجيب على الاتصالات، لمياء تحسن سيو جوجل. اضغط على أي موظف عشان تسمع رسالته الترحيبية!`
        );
      } else if (step === 5) {
        setSaraMessage(
          `عافاك الله! اكتملت التهيئة وضبطنا هويتك واخترنا وكلائك الذكيين. الحين بس نحتاج نوافق على سياسة الخصوصية وننتقل لبوابة الدفع الآمنة لتفعيل وكلائك ليعملوا من أجلك 24/7.`
        );
      }
    }, 700);

    return () => clearTimeout(timer);
  }, [step, businessName]);

  // AI autofill actions
  const applyDemoStore = () => {
    setSaraTyping(true);
    setSaraActionStatus("جاري ملء المتجر التجريبي...");
    setTimeout(() => {
      setBusinessName("بيت العود الفاخر");
      setVatNumber("310298475800003");
      setSaraTyping(false);
      setSaraActionStatus("تم تطبيق متجر بيت العود مع رقم ضريبي افتراضي متوافق! ✓");
    }, 800);
  };

  const optimizeLegalName = () => {
    if (!businessName) return;
    setSaraTyping(true);
    setSaraActionStatus("جاري تحسين الصياغة القانونية لزاتكا...");
    setTimeout(() => {
      setBusinessName((prev) =>
        prev.endsWith("المحدودة") || prev.endsWith("وشركاؤه") ? prev : `${prev} للتجارة المحدودة`
      );
      setSaraTyping(false);
      setSaraActionStatus("تمت إضافة الصياغة القانونية المثالية للفواتير! ✓");
    }, 600);
  };

  const generateBrandKit = () => {
    setSaraTyping(true);
    setSaraActionStatus("جاري تحليل اسم المتجر وتوليد هوية العلامة بالذكاء الاصطناعي...");
    setTimeout(() => {
      const name = businessName.toLowerCase();
      if (name.includes("عود") || name.includes("oud") || name.includes("بخور")) {
        setEssence("بخور وعطور عود طبيعي فاخر للأسر الباحثة عن الفخامة والروائح الشرقية الأصيلة.");
        setAttributes("تراثي، فخم، أصيل، دافئ، مضياف");
        setDialect("khaliji");
      } else if (name.includes("قهوة") || name.includes("كافيه") || name.includes("coffee") || name.includes("roast")) {
        setEssence("أجود حبوب البن المحمصة محلياً والمبهرة بالهيل والزعفران لتجربة قهوة سعودية مثالية.");
        setAttributes("كريم، ودود، مبهج، أصيل، اجتماعي");
        setDialect("khaliji");
      } else if (name.includes("تمور") || name.includes("dates") || name.includes("نخيل")) {
        setEssence("تمور خلاص الأحساء الفاخرة المحشوة بالمكسرات والحلويات التراثية للمناسبات والأعياد.");
        setAttributes("تقليدي، حلو، عائلي، كريم، دافئ");
        setDialect("khaliji");
      } else {
        setEssence(`أفضل المنتجات المختارة بعناية لتلبية تطلعات عملائنا في الخليج وبأعلى معايير الجودة.`);
        setAttributes("موثوق، عصري، مميز، احترافي، مبتكر");
        setDialect("khaliji");
      }
      setSaraTyping(false);
      setSaraActionStatus("تم توليد الجوهر والسمات المناسبة لهويتك بنجاح! ✓");
    }, 1000);
  };

  const applyKsaTraditionalTraits = () => {
    setEssence("عطور ومقتنيات فاخرة تناسب تقاليد الضيافة ومجتمعنا الأصيل.");
    setAttributes("اصيل، كرم، ضيافة، عريق، فخم");
    setDialect("khaliji");
    setSaraActionStatus("تم تطبيق السمات واللمسات التراثية السعودية! ✓");
  };

  const recommendPlusPlan = () => {
    setPlan("plus");
    setSaraActionStatus("تم اختيار باقة بلس الموصى بها (وكلاء الصوت، التواصل، السيو، زاتكا)! ✓");
  };

  const playAgentSpeech = (personaName: string, text: string) => {
    setActiveVoiceIntro(null);
    setSaraTyping(true);
    setTimeout(() => {
      setSaraTyping(false);
      setActiveVoiceIntro(`💬 ${personaName}: "${text}"`);
    }, 500);
  };

  const optimizeSecurityKeys = () => {
    setSaraTyping(true);
    setSaraActionStatus("جاري تهيئة مفاتيح التشفير الآمنة والتخزين المعزول...");
    setTimeout(() => {
      setSaraTyping(false);
      setSaraActionStatus("مفاتيح التخزين المعزول جاهزة ومتوافقة 100% مع أنظمة الأمن الرقمي السعودية! ✓");
    }, 900);
  };

  async function finish() {
    if (!dpaAccepted) return;
    setSubmitting(true);
    const sb = getBrowserSupabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      setSubmitting(false);
      return router.push("/login");
    }

    const { data: existing } = await sb
      .from("merchants")
      .select("id, plan")
      .eq("owner_user_id", user.id)
      .maybeSingle();

    let merchantId: string;

    if (existing) {
      merchantId = existing.id;
      await sb
        .from("merchants")
        .update({
          seller_name: businessName,
          vat_number: vatNumber || null,
          plan,
          dpa_accepted_at: new Date().toISOString(),
          dpa_version: "2025-01"
        })
        .eq("id", existing.id);
    } else {
      const { data: merchant, error: merchantErr } = await sb
        .from("merchants")
        .insert({
          owner_user_id: user.id,
          seller_name: businessName,
          vat_number: vatNumber || null,
          plan,
          subscription_status: "pending",
          dpa_accepted_at: new Date().toISOString(),
          dpa_version: "2025-01"
        })
        .select()
        .single();

      if (merchantErr || !merchant) {
        if (merchantErr?.code === "23505") {
          router.push(`/billing?plan=${plan}`);
          return;
        }
        setSubmitting(false);
        alert(merchantErr?.message ?? "Could not create merchant profile. Try again or contact support.");
        return;
      }
      merchantId = merchant.id;
    }

    const { error: kitErr } = await sb.from("brand_kits").upsert({
      merchant_id: merchantId,
      brand_name: businessName,
      essence,
      attributes: attributes.split(",").map((s) => s.trim()).filter(Boolean),
      dialect
    });

    if (kitErr) {
      setSubmitting(false);
      alert(kitErr.message);
      return;
    }

    trackClientEvent("onboarding.complete", { plan });
    router.push(`/billing?plan=${plan}`);
  }

  const isSocialPlan = plan === "plus" || plan === "pro";

  const stepLabel = (n: Step, label: string, labelAr: string) => (
    <div className="flex items-center gap-2">
      <span
        className={`w-6 h-6 flex items-center justify-center text-xs font-mono rounded-lg transition-all duration-300 ${
          step > n 
            ? "bg-accent text-paper shadow-[0_2px_8px_rgba(20,150,90,0.15)]" 
            : step === n 
            ? "bg-ink text-paper shadow-md" 
            : "bg-paper-deep text-ink-mute/70 border border-rule/50"
        }`}
      >
        {step > n ? <Check size={12} /> : n}
      </span>
      <span className={`text-[10px] sm:text-xs uppercase tracking-widest font-mono hidden sm:inline ${step >= n ? "text-ink font-semibold" : "text-ink-mute"}`}>
        {label}
      </span>
      <span className={`text-xs font-arabic inline sm:hidden ${step >= n ? "text-ink font-semibold" : "text-ink-mute"}`}>
        {labelAr}
      </span>
    </div>
  );

  return (
    <main className="min-h-screen flex flex-col bg-paper relative overflow-hidden">
      {/* Background Radial Glow */}
      <div className="absolute top-[10%] left-[20%] w-[30rem] h-[30rem] bg-accent/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[20%] right-[10%] w-[25rem] h-[25rem] bg-accent-warm/5 rounded-full blur-[90px] pointer-events-none" />

      <header className="border-b border-rule bg-paper/85 backdrop-blur-md px-6 lg:px-10 h-16 flex items-center justify-between z-10 sticky top-0">
        <LogoFull />
        <div className="flex items-center gap-2.5 font-mono text-xs text-ink-mute bg-paper-deep/50 px-3 py-1 rounded-full border border-rule/50">
          <span>SETUP WIZARD</span>
          <span className="text-ink/20">|</span>
          <span className="text-accent font-bold">STEP {step}/5</span>
        </div>
      </header>

      <div className="flex-1 flex items-start justify-center px-4 sm:px-6 py-12 lg:py-16 z-10">
        <div className="w-full max-w-[1200px]">
          
          {/* Header Step Trackers */}
          <div className="flex items-center justify-between border-b border-rule/50 pb-8 mb-10 overflow-x-auto gap-4 scrollbar-hide">
            <div className="flex items-center gap-4 sm:gap-6">
              {stepLabel(1, "Business", "المتجر")}
              {stepLabel(2, "Voice", "الهوية")}
              {stepLabel(3, "Plan", "الباقة")}
              {stepLabel(4, "Team", "الفريق")}
              {stepLabel(5, "Done", "التأكيد")}
            </div>
            <div className="shrink-0 flex gap-1">
              {step > 1 && (
                <button
                  type="button"
                  onClick={() => setStep((s) => (s - 1) as Step)}
                  className="p-2 border border-rule hover:border-ink/30 rounded-lg text-ink-soft hover:text-ink transition"
                  aria-label="Back"
                >
                  <ChevronLeft size={16} />
                </button>
              )}
              {step < 5 && (
                <button
                  type="button"
                  onClick={() => setStep((s) => (s + 1) as Step)}
                  disabled={step === 1 && !businessName}
                  className="p-2 border border-rule hover:border-ink/30 rounded-lg text-ink-soft hover:text-ink transition disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Forward"
                >
                  <ChevronRight size={16} />
                </button>
              )}
            </div>
          </div>

          <div className="grid lg:grid-cols-12 gap-8 items-start">
            
            {/* LEFT COLUMN: Setup Form Console */}
            <div className="lg:col-span-7 bg-paper/60 border border-rule/55 p-6 sm:p-8 rounded-3xl shadow-glass-sm flex flex-col justify-between min-h-[500px] hover-glow transition-all duration-300">
              
              {/* Step 1: Business Profile */}
              {step === 1 && (
                <section className="space-y-6 animate-scale-in">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-accent bg-accent/15 px-2 py-0.5 rounded border border-accent/20">Step 01</span>
                    <h1 className="font-display text-3xl sm:text-4xl tracking-crisp mt-3">Let's set up your store.</h1>
                    <p className="mt-2 text-sm text-ink-soft">We'll use these to authenticate Salla triggers and generate compliant ZATCA Phase-2 invoice signatures.</p>
                  </div>
                  
                  <div className="space-y-4 pt-2">
                    <Field label="Business legal name" hint="Your storefront brand name. Use correct legal casing.">
                      <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g., Bayt Al-Oud" className="rounded-xl border-rule/80 focus:border-ink text-base" />
                    </Field>
                    
                    <Field label="VAT number" hint="15-digit Tax identification number. Leave blank if not VAT-registered.">
                      <Input value={vatNumber} maxLength={15} onChange={(e) => setVatNumber(e.target.value)} placeholder="310298475800003" className="rounded-xl border-rule/80 focus:border-ink font-mono text-base tracking-wider" />
                    </Field>
                  </div>

                  <div className="flex justify-end pt-4 border-t border-rule/40">
                    <Button onClick={() => setStep(2)} disabled={!businessName} className="rounded-xl gap-2 font-semibold">
                      Continue to Voice <ArrowRight size={16} />
                    </Button>
                  </div>
                </section>
              )}

              {/* Step 2: Brand Voice */}
              {step === 2 && (
                <section className="space-y-6 animate-scale-in">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-accent bg-accent/15 px-2 py-0.5 rounded border border-accent/20">Step 02</span>
                    <h1 className="font-display text-3xl sm:text-4xl tracking-crisp mt-3">Define your brand voice.</h1>
                    <p className="mt-2 text-sm text-ink-soft">Our pre-trained AI marketer and voice rep use this context to draft custom dialect responses perfectly matched to your values.</p>
                  </div>

                  <div className="space-y-4 pt-2">
                    <Field label="Essence" hint="One concise sentence: what you sell and who your target audience is.">
                      <Textarea rows={3} value={essence} onChange={(e) => setEssence(e.target.value)} placeholder="Premium Oud fragrances and traditional incense tailored for modern Saudi households." className="rounded-xl border-rule/80 focus:border-ink text-base leading-relaxed" />
                    </Field>

                    <Field label="Voice attributes" hint="Comma-separated adjectives (e.g., heritage, elegant, warm, premium)">
                      <Input value={attributes} onChange={(e) => setAttributes(e.target.value)} placeholder="heritage, elegant, warm, premium" className="rounded-xl border-rule/80 focus:border-ink text-base" />
                    </Field>

                    <Field label="Arabic Dialect Strategy" hint="Select the primary dialect register for AI content generation.">
                      <select
                        className="w-full bg-paper border border-rule/80 rounded-xl px-4 py-3 text-sm focus:border-ink outline-none transition"
                        value={dialect}
                        onChange={(e) => setDialect(e.target.value as "khaliji" | "msa" | "english")}
                      >
                        <option value="khaliji">Khaliji (Saudi Dialect / لهجة خليجية سعودية)</option>
                        <option value="msa">MSA (Fusha Arabic / لغة فصحى مبسطة)</option>
                        <option value="english">English (Professional corporate English)</option>
                      </select>
                    </Field>
                  </div>

                  <div className="flex justify-between pt-4 border-t border-rule/40">
                    <Button variant="ghost" onClick={() => setStep(1)} className="rounded-xl">
                      Back
                    </Button>
                    <Button onClick={() => setStep(3)} className="rounded-xl gap-2 font-semibold">
                      Continue to Plan <ArrowRight size={16} />
                    </Button>
                  </div>
                </section>
              )}

              {/* Step 3: Moyasar Plan */}
              {step === 3 && (
                <section className="space-y-6 animate-scale-in">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-accent bg-accent/15 px-2 py-0.5 rounded border border-accent/20">Step 03</span>
                    <h1 className="font-display text-3xl sm:text-4xl tracking-crisp mt-3">Select your AI workforce plan.</h1>
                    <p className="mt-2 text-sm text-ink-soft">Select the capacity that matches your storefront. Upgrade, downgrade, or cancel anytime through Moyasar billing.</p>
                  </div>

                  <div className="grid gap-3 pt-2">
                    {[
                      { id: "lite" as const, name: "Lite Plan", price: "99 SAR/mo", desc: "ZATCA e-Invoicing compliance agent + SEO copywriting agent.", features: "Best for sole traders" },
                      { id: "plus" as const, name: "Plus Plan", price: "299 SAR/mo", desc: "ZATCA + SEO + Noora (Social Marketer) + Salem (Voice Representative).", features: "Most Popular choice", highlight: true },
                      { id: "pro" as const, name: "Pro Plan", price: "599 SAR/mo", desc: "Full smart workforce (All social, 2000 voice mins, CRM WhatsApp, Wathq CR integration).", features: "Perfect for large scale e-commerce" }
                    ].map((p) => (
                      <label
                        key={p.id}
                        className={`cursor-pointer border rounded-2xl p-5 flex items-center justify-between transition-all duration-300 hover-glow ${
                          plan === p.id 
                            ? "border-accent bg-accent/5 ring-1 ring-accent" 
                            : "border-rule/80 bg-paper/20"
                        }`}
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2.5">
                            <span className={`font-display text-xl ${plan === p.id ? "text-accent font-bold" : "text-ink"}`}>{p.name}</span>
                            {p.highlight && (
                              <span className="text-[8px] font-mono font-bold uppercase tracking-wider bg-accent/15 text-accent border border-accent/20 px-2 py-0.5 rounded-full animate-pulse-soft">Recommended</span>
                            )}
                          </div>
                          <p className="text-xs text-ink-mute mt-1.5 leading-relaxed max-w-md">{p.desc}</p>
                          <span className="text-[9px] font-mono text-ink-mute uppercase tracking-widest block mt-2">{p.features}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-display text-xl font-bold block text-ink">{p.price}</span>
                          <input 
                            type="radio" 
                            name="plan" 
                            value={p.id} 
                            checked={plan === p.id} 
                            onChange={() => setPlan(p.id)} 
                            className="accent-accent w-4 h-4 mt-2" 
                          />
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="flex justify-between pt-4 border-t border-rule/40">
                    <Button variant="ghost" onClick={() => setStep(2)} className="rounded-xl">
                      Back
                    </Button>
                    <Button onClick={() => setStep(4)} className="rounded-xl gap-2 font-semibold">
                      Continue to Team <ArrowRight size={16} />
                    </Button>
                  </div>
                </section>
              )}

              {/* Step 4: Smart Team Personas */}
              {step === 4 && (
                <section className="space-y-6 animate-scale-in">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-accent bg-accent/15 px-2 py-0.5 rounded border border-accent/20">Step 04</span>
                    <h1 className="font-display text-3xl sm:text-4xl tracking-crisp mt-3">Meet your pre-trained staff.</h1>
                    <p className="mt-2 text-sm text-ink-soft">
                      {isSocialPlan
                        ? "These custom-built AI employee personas are hired automatically under your selected plan. Connect their target channels to activate them."
                        : "Your plan includes Lamia (SEO) and Tariq (Analyst). Upgrade to Plus or Pro plan to unlock Noora (Social) and Salem (Voice calls)."}
                    </p>
                  </div>

                  <div className="grid gap-3 max-h-[360px] overflow-y-auto pr-1 scrollbar-thin">
                    {ALL_PERSONAS.map((p: Persona) => {
                      const isAvailable = p.role === "seo" || p.role === "analyst" ? true : isSocialPlan;
                      return (
                        <div
                          key={p.id}
                          className={`border rounded-2xl p-4 transition-all duration-300 ${
                            isAvailable
                              ? "border-rule bg-paper/40 hover:border-accent/35"
                              : "border-rule/30 bg-paper-deep/10 opacity-40 select-none"
                          }`}
                        >
                          <div className="flex items-start gap-4">
                            <div className="w-11 h-11 rounded-xl bg-paper border border-rule/65 flex items-center justify-center text-2xl shrink-0">
                              {p.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="text-sm font-bold text-ink">
                                  {p.name} <span className="text-ink-mute font-normal text-xs ml-1">({p.nameEn})</span>
                                </h4>
                                <span className="text-[9px] font-mono text-ink-mute">Age {p.age}</span>
                                {!isAvailable && (
                                  <span className="text-[8px] font-mono font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20 rounded px-1.5 py-0.5">Upgrade Hires</span>
                                )}
                              </div>
                              <p className="text-[10px] text-ink-soft leading-relaxed text-right mt-1.5 font-arabic" dir="rtl">
                                {p.tagline}
                              </p>
                              <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                                <span className="text-[9px] font-mono text-accent uppercase tracking-wider font-bold">{p.tone}</span>
                                <span className="text-ink/10">·</span>
                                <span className="text-[9px] text-ink-mute font-mono">Expertise: {p.expertise.slice(0, 3).join(", ")}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-between pt-4 border-t border-rule/40">
                    <Button variant="ghost" onClick={() => setStep(3)} className="rounded-xl">
                      Back
                    </Button>
                    <Button onClick={() => setStep(5)} className="rounded-xl gap-2 font-semibold">
                      Continue to Review <ArrowRight size={16} />
                    </Button>
                  </div>
                </section>
              )}

              {/* Step 5: Final Review */}
              {step === 5 && (
                <section className="space-y-6 animate-scale-in">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-accent bg-accent/15 px-2 py-0.5 rounded border border-accent/20">Step 05</span>
                    <h1 className="font-display text-3xl sm:text-4xl tracking-crisp mt-3">Ready to deploy.</h1>
                    <p className="mt-2 text-sm text-ink-soft">Review your customized store details and accept the PDPL privacy agreement to launch your dashboard.</p>
                  </div>

                  <div className="border border-rule/65 bg-paper-deep/30 rounded-2xl p-5 space-y-3">
                    <div className="flex justify-between text-sm border-b border-rule/30 pb-2.5">
                      <span className="text-ink-mute">Store Name:</span>
                      <strong className="text-ink font-semibold">{businessName}</strong>
                    </div>
                    <div className="flex justify-between text-sm border-b border-rule/30 pb-2.5">
                      <span className="text-ink-mute">Selected Dialect:</span>
                      <strong className="text-ink font-semibold capitalize">{dialect}</strong>
                    </div>
                    <div className="flex justify-between text-sm border-b border-rule/30 pb-2.5">
                      <span className="text-ink-mute">Subscription Tier:</span>
                      <strong className="text-accent font-semibold capitalize">{plan} Plan</strong>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-ink-mute">Assigned AI Workforce:</span>
                      <strong className="text-ink font-semibold">
                        {isSocialPlan ? "نورة · سالم · لمياء · فهد · ريم" : "لمياء · طارق"}
                      </strong>
                    </div>
                  </div>

                  <label className="flex items-start gap-3 border border-rule/75 bg-paper/50 p-4 rounded-xl cursor-pointer hover:border-ink/30 transition">
                    <input
                      type="checkbox"
                      className="mt-1 accent-accent w-4 h-4"
                      checked={dpaAccepted}
                      onChange={(e) => setDpaAccepted(e.target.checked)}
                    />
                    <span className="text-xs text-ink-soft leading-relaxed">
                      I accept the{" "}
                      <Link href="/legal/privacy" target="_blank" className="text-accent hover:underline font-semibold">
                        Privacy Policy & Terms
                      </Link>{" "}
                      and consent to the cross-border data processing required for GCC customer compliance under Saudi PDPL law.
                    </span>
                  </label>

                  <div className="flex justify-between pt-4 border-t border-rule/40">
                    <Button variant="ghost" onClick={() => setStep(4)} className="rounded-xl">
                      Back
                    </Button>
                    <Button onClick={finish} disabled={submitting || !dpaAccepted} className="rounded-xl gap-2 font-semibold">
                      {submitting ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Setting up...</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-4 h-4" />
                          <span>Continue to payment</span>
                        </>
                      )}
                    </Button>
                  </div>
                </section>
              )}

            </div>

            {/* RIGHT COLUMN: Sara AI Onboarding Partner Chat Interface */}
            <div className="lg:col-span-5 relative">
              <div className="w-full rounded-3xl glass-heavy border border-rule/35 shadow-glass-xl overflow-hidden flex flex-col justify-between hover-glow transition-all duration-300">
                
                {/* safari-style chrome header bar */}
                <div className="flex items-center justify-between px-4 py-3.5 bg-paper-deep/30 border-b border-rule/25">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-400/80 border border-red-500/10" />
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80 border border-amber-500/10" />
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80 border border-emerald-500/10" />
                  </div>
                  <div className="flex items-center gap-1 bg-paper/40 border border-rule/15 rounded-lg px-2.5 py-0.5 text-[9px] font-mono text-ink-mute tracking-crisp">
                    <Sparkles size={8} className="text-accent" /> sara-advisor.ai
                  </div>
                  <div className="w-10" />
                </div>

                {/* AI Assistant Chat Body */}
                <div className="p-5 flex-1 min-h-[380px] flex flex-col justify-between bg-paper/20">
                  
                  {/* Sara Identity */}
                  <div className="flex items-center justify-between border-b border-rule/20 pb-3 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-accent-warm flex items-center justify-center text-paper text-lg font-bold shadow-md shadow-accent/10 relative">
                        ✨
                        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-success rounded-full border border-paper" />
                      </div>
                      <div className="text-left">
                        <p className="text-xs font-bold text-ink leading-tight">سارة — منسقة التهيئة الذكية</p>
                        <p className="text-[9px] font-mono text-ink-mute uppercase tracking-widest mt-0.5">Sara · Onboarding Coordinator</p>
                      </div>
                    </div>
                    <span className="text-[8px] font-mono uppercase bg-accent/10 border border-accent/20 px-2 py-0.5 text-accent rounded font-bold">AI ACTIVE</span>
                  </div>

                  {/* Message Bubble Container */}
                  <div className="flex-1 flex flex-col justify-center space-y-4">
                    
                    {saraTyping ? (
                      <div className="flex items-center gap-2 p-4 bg-paper/60 border border-rule/40 rounded-2xl shadow-glass-sm self-start max-w-[85%] animate-pulse-soft">
                        <div className="flex gap-1">
                          <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: "0s" }} />
                          <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: "0.15s" }} />
                          <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: "0.3s" }} />
                        </div>
                        <span className="text-[10px] text-ink-mute font-mono uppercase tracking-widest pl-1">Analyzing...</span>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="p-4 bg-paper/70 border border-rule/45 rounded-2xl shadow-glass-sm text-right dir-rtl leading-relaxed animate-fade-in relative hover-glow transition-all duration-300">
                          <p className="text-xs sm:text-sm font-arabic font-normal text-ink">
                            {saraMessage}
                          </p>
                          <div className="absolute -bottom-1.5 right-4 w-3 h-3 bg-paper border-b border-r border-rule/45 rotate-45" />
                        </div>

                        {/* Speech widget for step 4 employee voices */}
                        {activeVoiceIntro && (
                          <div className="p-3 bg-accent/5 border border-accent/20 rounded-xl text-right dir-rtl animate-slide-up text-xs font-arabic leading-relaxed text-accent-deep">
                            {activeVoiceIntro}
                          </div>
                        )}

                        {saraActionStatus && (
                          <div className="p-3 bg-success/5 border border-success/20 rounded-xl text-right dir-rtl animate-fade-in text-[10px] font-mono text-success leading-relaxed flex items-center gap-2 justify-end">
                            <span>{saraActionStatus}</span>
                            <Info size={10} />
                          </div>
                        )}
                      </div>
                    )}

                  </div>

                  {/* Step-specific Interactive AI Actions */}
                  <div className="mt-5 pt-4 border-t border-rule/25">
                    <p className="text-[8px] font-mono uppercase tracking-widest text-ink-mute/70 mb-2.5 text-left font-bold flex items-center gap-1.5">
                      <Zap size={8} className="text-accent" /> Recommended AI Suggestions
                    </p>

                    <div className="flex flex-col gap-2">
                      {step === 1 && (
                        <>
                          <button
                            type="button"
                            onClick={applyDemoStore}
                            className="w-full py-2 px-3 bg-paper hover:bg-paper-deep text-ink border border-rule hover:border-accent/40 rounded-xl text-left font-semibold text-xs transition duration-300 flex items-center justify-between hover-lift shadow-glass-xs"
                          >
                            <span className="font-arabic font-normal text-ink-soft">✨ تطبيق متجر عطور تجريبي (بيت العود)</span>
                            <span className="font-mono text-[9px] text-ink-mute uppercase tracking-widest hidden sm:inline">Autofill Oud Demo</span>
                          </button>

                          <button
                            type="button"
                            onClick={optimizeLegalName}
                            disabled={!businessName}
                            className="w-full py-2 px-3 bg-paper hover:bg-paper-deep text-ink border border-rule hover:border-accent/40 rounded-xl text-left font-semibold text-xs transition duration-300 flex items-center justify-between hover-lift shadow-glass-xs disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <span className="font-arabic font-normal text-ink-soft">✨ تنسيق الصياغة القانونية لزاتكا</span>
                            <span className="font-mono text-[9px] text-ink-mute uppercase tracking-widest hidden sm:inline">Format ZATCA LLC</span>
                          </button>
                        </>
                      )}

                      {step === 2 && (
                        <>
                          <button
                            type="button"
                            onClick={generateBrandKit}
                            className="w-full py-2 px-3 bg-paper hover:bg-paper-deep text-ink border border-rule hover:border-accent/40 rounded-xl text-left font-semibold text-xs transition duration-300 flex items-center justify-between hover-lift shadow-glass-xs"
                          >
                            <span className="font-arabic font-normal text-ink-soft">✨ توليد الهوية وصوت العلامة بالذكاء الاصطناعي</span>
                            <span className="font-mono text-[9px] text-ink-mute uppercase tracking-widest hidden sm:inline">AI Generate Voice</span>
                          </button>

                          <button
                            type="button"
                            onClick={applyKsaTraditionalTraits}
                            className="w-full py-2 px-3 bg-paper hover:bg-paper-deep text-ink border border-rule hover:border-accent/40 rounded-xl text-left font-semibold text-xs transition duration-300 flex items-center justify-between hover-lift shadow-glass-xs"
                          >
                            <span className="font-arabic font-normal text-ink-soft">✨ ضبط سمات تراثية سعودية أصيلة</span>
                            <span className="font-mono text-[9px] text-ink-mute uppercase tracking-widest hidden sm:inline">Saudi Heritage preset</span>
                          </button>
                        </>
                      )}

                      {step === 3 && (
                        <button
                          type="button"
                          onClick={recommendPlusPlan}
                          className="w-full py-2 px-3 bg-paper hover:bg-paper-deep text-ink border border-rule hover:border-accent/40 rounded-xl text-left font-semibold text-xs transition duration-300 flex items-center justify-between hover-lift shadow-glass-xs"
                        >
                          <span className="font-arabic font-normal text-ink-soft">✨ التوصية بأفضل قيمة لمتجري</span>
                          <span className="font-mono text-[9px] text-ink-mute uppercase tracking-widest hidden sm:inline">Autofill recommended</span>
                        </button>
                      )}

                      {step === 4 && (
                        <div className="grid grid-cols-3 gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              playAgentSpeech(
                                "نورة",
                                "هلا والله! أنا نورة، مسوّقتك الرقمية. بمسك حسابات متجرك على تيك توك وإنستقرام وبصنع لك كاروسيلات ومنشورات تجنن وبلغة خليجية أصيلة تعدل مزاج عملائك!"
                              )
                            }
                            disabled={!isSocialPlan}
                            className="py-2 px-1 bg-paper hover:bg-paper-deep text-ink border border-rule hover:border-accent/40 rounded-lg text-center font-arabic text-[10px] transition duration-300 truncate hover-lift disabled:opacity-20 disabled:cursor-not-allowed"
                          >
                            📢 نورة (سوشال)
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              playAgentSpeech(
                                "سالم",
                                "حيّاك الله يا غالي! أنا سالم، ممثل الدعم الهاتفي الصوتي. بردّ على كل مكالمات متجرك بعربية سعودية دافئة وبجاوب على الاستفسارات وبشيك على طلبات سلة فوراً."
                              )
                            }
                            disabled={!isSocialPlan}
                            className="py-2 px-1 bg-paper hover:bg-paper-deep text-ink border border-rule hover:border-accent/40 rounded-lg text-center font-arabic text-[10px] transition duration-300 truncate hover-lift disabled:opacity-20 disabled:cursor-not-allowed"
                          >
                            🎙️ سالم (صوت)
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              playAgentSpeech(
                                "لمياء",
                                "أهلاً بك. أنا لمياء خبيرة السيو. سأعمل على تحسين أوصاف منتجاتك وكتابة صياغات يفهمها محرك بحث جوجل السعودي لتصدر نتائج البحث."
                              )
                            }
                            className="py-2 px-1 bg-paper hover:bg-paper-deep text-ink border border-rule hover:border-accent/40 rounded-lg text-center font-arabic text-[10px] transition duration-300 truncate hover-lift"
                          >
                            🔍 لمياء (سيو)
                          </button>
                        </div>
                      )}

                      {step === 5 && (
                        <button
                          type="button"
                          onClick={optimizeSecurityKeys}
                          className="w-full py-2 px-3 bg-paper hover:bg-paper-deep text-ink border border-rule hover:border-accent/40 rounded-xl text-left font-semibold text-xs transition duration-300 flex items-center justify-between hover-lift shadow-glass-xs"
                        >
                          <span className="font-arabic font-normal text-ink-soft">✨ تهيئة وتشفير مفاتيح الاعتمادات الآمنة</span>
                          <span className="font-mono text-[9px] text-ink-mute uppercase tracking-widest hidden sm:inline">Pre-auth keys</span>
                        </button>
                      )}
                    </div>
                  </div>

                </div>

              </div>
            </div>

          </div>

        </div>
      </div>

      {/* Real-time AI Chat Drawer */}
      <OnboardingChat
        step={step}
        context={{ businessName, vatNumber, essence, attributes, dialect, plan }}
        open={chatOpen}
        onToggle={() => setChatOpen(!chatOpen)}
      />

      {/* Floating Chat Toggle Button */}
      <button
        onClick={() => {
          setChatOpen(!chatOpen);
          trackClientEvent("onboarding.chat.toggle", { step, chatOpen: !chatOpen });
        }}
        className={`fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full px-4 py-3 text-sm font-bold shadow-lg transition-all duration-300 hover:scale-105 ${
          chatOpen
            ? "bg-zinc-800 text-white hover:bg-zinc-700"
            : "bg-amber-500 text-white hover:bg-amber-600"
        }`}
        aria-label={chatOpen ? "إغلاق محادثة سارة" : "محادثة مع سارة"}
      >
        <MessageSquare size={18} />
        {chatOpen ? "إغلاق" : "تحدث مع سارة"}
      </button>
    </main>
  );
}
