"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/primitives";
import { LogoFull } from "@/components/ui/logo";
import {
  Check,
  ArrowRight,
  Sparkles,
  RefreshCw,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Zap,
  Info,
  AlertTriangle
} from "lucide-react";
import { trackClientEvent } from "@/lib/analytics/client";
import { ALL_PERSONAS, type Persona } from "@/lib/agents/personas";
import { planCards, planModules, personaAvailableOnPlan } from "@/lib/billing/plan-summary";
import {
  MAX_BRAND_ATTRIBUTES,
  MAX_BRAND_ESSENCE,
  MAX_BRAND_NAME,
  brandListError,
  splitAttributes
} from "@/lib/merchant/onboarding-schema";
import OnboardingChat from "@/components/dashboard/onboarding-chat";

type Step = 1 | 2 | 3 | 4 | 5;
type Dialect = "khaliji" | "msa" | "english";

// Plan cards and module lists come from lib/billing (prices + entitlements), so the
// wizard cannot advertise anything the API would refuse.
const PLAN_CARDS = planCards();
const TEAM_PERSONAS = ALL_PERSONAS.filter((p) => p.role !== "onboarding");

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `HTTP ${res.status}`;
}

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
  const [dialect, setDialect] = useState<Dialect>("khaliji");
  const [kitGenerating, setKitGenerating] = useState(false);
  const [kitError, setKitError] = useState<string | null>(null);
  // Checked where it is typed: an over-long attribute would otherwise only fail at step 5.
  const attributesIssue = brandListError(attributes, MAX_BRAND_ATTRIBUTES);

  // Step 3: plan tier
  const [plan, setPlan] = useState<"lite" | "plus" | "pro">("plus");

  // Step 4: confirm
  const [dpaAccepted, setDpaAccepted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
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
          "أهلاً وسهلاً بك في أرب كلو! 🇸🇦 أنا سارة، منسقة التهيئة الرقمية المخصصة لمساعدتك في توظيف وتدريب فريق عملك من وكلاء الذكاء الاصطناعي. خلّنا نبدأ بتسجيل متجرك: اكتب الاسم كما هو في سجلك التجاري، وأضف رقمك الضريبي إذا كنت مسجلاً في ضريبة القيمة المضافة."
        );
      } else if (step === 2) {
        setSaraMessage(
          `يا سلام، متجر ${businessName || "العود الفاخر"} اسم مميز! الحين خلّنا نحدد "صوت وهوية العلامة التجارية". الذكاء الاصطناعي يقدر يحلل نشاطك ويقترح جملة الجوهر والسمات التراثية المناسبة للخليج بضغطة زر!`
        );
      } else if (step === 3) {
        setSaraMessage(
          "تسلسل رائع! الحين تختار الباقة المناسبة لحجم متجرك. تفاصيل كل باقة والوحدات المشمولة فيها موضحة بجانبها، وتقدر تغيّر باقتك في أي وقت من صفحة الفوترة."
        );
      } else if (step === 4) {
        setSaraMessage(
          `تعرّف على فريقك الذكي يا غالي! كل وكيل له لهجة محلية وأسلوب خاص: نورة للسوشال، سالم للمكالمات، لمياء لسيو جوجل. الوكلاء المشمولون في باقتك يتفعّلون من لوحة التحكم بعد تأكيد الدفع وربط قنواتهم. اضغط على أي موظف عشان تسمع رسالته الترحيبية!`
        );
      } else if (step === 5) {
        setSaraMessage(
          `آخر خطوة! راجع بيانات متجرك، ووافق على سياسة الخصوصية واتفاقية معالجة البيانات، وبعدها ننتقل لبوابة الدفع الآمنة (ميسر) لتفعيل باقتك.`
        );
      }
    }, 700);

    return () => clearTimeout(timer);
  }, [step, businessName]);

  // Real AI suggestion (POST /api/brand-kit/generate); the merchant reviews it before saving.
  async function generateBrandKit() {
    const name = businessName.trim();
    if (!name || kitGenerating) return;
    setKitGenerating(true);
    setKitError(null);
    setSaraActionStatus("جاري تحليل اسم المتجر وتوليد هوية العلامة بالذكاء الاصطناعي...");
    try {
      const res = await fetch("/api/brand-kit/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brand_name: name, description: essence.trim() || undefined })
      });
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as {
        kit?: { essence?: string; attributes?: string[]; dialect?: Dialect };
      };
      const kit = body.kit;
      if (!kit?.essence) throw new Error("Empty response");
      setEssence(kit.essence);
      setAttributes((kit.attributes ?? []).join("، "));
      if (kit.dialect) setDialect(kit.dialect);
      setSaraActionStatus("تم توليد الجوهر والسمات بالذكاء الاصطناعي — راجعها وعدّلها كما تحب ✓");
    } catch (err) {
      setSaraActionStatus(null);
      setKitError(err instanceof Error ? err.message : String(err));
    } finally {
      setKitGenerating(false);
    }
  }

  // A preset of voice traits (not AI): fills the attributes and dialect only.
  const applyKsaTraditionalTraits = () => {
    setAttributes("أصيل، كريم، مضياف، عريق، فخم");
    setDialect("khaliji");
    setSaraActionStatus("تم تطبيق السمات التراثية السعودية ✓");
  };

  const recommendPlusPlan = () => {
    setPlan("plus");
    setSaraActionStatus(`تم اختيار باقة بلس: ${planModules("plus").map((m) => m.ar).join("، ")} ✓`);
  };

  const playAgentSpeech = (personaName: string, text: string) => {
    setActiveVoiceIntro(`💬 ${personaName}: "${text}"`);
  };

  // The only write of the wizard: the server creates/updates the merchant (always
  // lite/pending for a new store) and the brand kit. The chosen plan is paid for at
  // /billing and applied when Moyasar confirms the payment.
  async function finish() {
    if (!dpaAccepted || submitting) return;
    if (attributesIssue) {
      setStep(2);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/merchant/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessName: businessName.trim(),
          vatNumber: vatNumber.trim(),
          dpaAccepted: true,
          brandKit: { essence: essence.trim(), attributes: splitAttributes(attributes), dialect }
        })
      });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) throw new Error(await readError(res));
      trackClientEvent("onboarding.complete", { plan });
      router.push(`/billing?plan=${plan}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  const selectedPlan = PLAN_CARDS.find((p) => p.id === plan) ?? PLAN_CARDS[0];
  const includedModules = planModules(plan);
  const teamAvailable = TEAM_PERSONAS.some((p) => personaAvailableOnPlan(p.role, plan));

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
                  disabled={(step === 1 && !businessName) || (step === 2 && attributesIssue !== null)}
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
                      <Input dir="auto" value={businessName} maxLength={MAX_BRAND_NAME} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g., Bayt Al-Oud" className="rounded-xl border-rule/80 focus:border-ink text-base" />
                    </Field>
                    
                    <Field label="VAT number" hint="15-digit Tax identification number. Leave blank if not VAT-registered.">
                      <Input value={vatNumber} maxLength={15} inputMode="numeric" onChange={(e) => setVatNumber(e.target.value)} placeholder="3XXXXXXXXXXXXX3" className="rounded-xl border-rule/80 focus:border-ink font-mono text-base tracking-wider" />
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
                      <Textarea dir="auto" rows={3} maxLength={MAX_BRAND_ESSENCE} value={essence} onChange={(e) => setEssence(e.target.value)} placeholder="Premium Oud fragrances and traditional incense tailored for modern Saudi households." className="rounded-xl border-rule/80 focus:border-ink text-base leading-relaxed" />
                    </Field>

                    <Field label="Voice attributes" hint="Comma-separated adjectives — , or ، (e.g., heritage, elegant, warm, premium)">
                      <Input
                        dir="auto"
                        value={attributes}
                        onChange={(e) => setAttributes(e.target.value)}
                        aria-invalid={attributesIssue !== null}
                        aria-describedby={attributesIssue ? "voice-attributes-error" : undefined}
                        placeholder="heritage, elegant, warm, premium"
                        className="rounded-xl border-rule/80 focus:border-ink text-base"
                      />
                      {attributesIssue && (
                        <div id="voice-attributes-error" role="alert" className="text-[11px] leading-relaxed text-red-700 dark:text-red-400">
                          <p className="font-arabic" dir="rtl">{attributesIssue.ar}</p>
                          <p>{attributesIssue.en}</p>
                        </div>
                      )}
                    </Field>

                    <Field label="Arabic Dialect Strategy" hint="Select the primary dialect register for AI content generation.">
                      <select
                        className="w-full bg-paper border border-rule/80 rounded-xl px-4 py-3 text-sm focus:border-ink outline-none transition"
                        value={dialect}
                        onChange={(e) => setDialect(e.target.value as Dialect)}
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
                    <Button onClick={() => setStep(3)} disabled={attributesIssue !== null} className="rounded-xl gap-2 font-semibold">
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
                    {PLAN_CARDS.map((p) => (
                      <label
                        key={p.id}
                        className={`cursor-pointer border rounded-2xl p-5 flex items-center justify-between gap-4 transition-all duration-300 hover-glow ${
                          plan === p.id 
                            ? "border-accent bg-accent/5 ring-1 ring-accent" 
                            : "border-rule/80 bg-paper/20"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2.5">
                            <span className={`font-display text-xl ${plan === p.id ? "text-accent font-bold" : "text-ink"}`}>{p.name} Plan</span>
                            {p.id === "plus" && (
                              <span className="text-[8px] font-mono font-bold uppercase tracking-wider bg-accent/15 text-accent border border-accent/20 px-2 py-0.5 rounded-full animate-pulse-soft">Recommended</span>
                            )}
                          </div>
                          <p className="text-xs text-ink-soft mt-1.5 leading-relaxed font-arabic text-right" dir="rtl">
                            {p.modules.map((m) => m.ar).join(" · ")}
                          </p>
                          <p className="text-[11px] text-ink-mute mt-1 leading-relaxed">{p.features.join(" · ")}</p>
                          {p.employeeSeats > 0 && (
                            <span className="text-[9px] font-mono text-ink-mute uppercase tracking-widest block mt-2">
                              Up to {p.employeeSeats} AI employees · حتى {p.employeeSeats} موظفين أذكياء
                            </span>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-display text-xl font-bold block text-ink">{p.price}</span>
                          <span className="text-[10px] text-ink-mute block">/ month · شهرياً</span>
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
                      {teamAvailable
                        ? `Team members marked as included are part of the ${selectedPlan.name} plan. Switch them on from your dashboard once payment is confirmed and their channels are connected.`
                        : `The ${selectedPlan.name} plan covers ZATCA e-invoicing. AI team members (social, voice, SEO) are included from the Plus plan.`}
                    </p>
                    <p className="mt-1.5 text-xs text-ink-mute font-arabic text-right" dir="rtl">
                      {teamAvailable
                        ? "الموظفون المشمولون في باقتك تشغّلهم من لوحة التحكم بعد تأكيد الدفع وربط قنواتهم."
                        : "باقتك تغطي فواتير زاتكا الإلكترونية. وكلاء السوشال والمكالمات والسيو متاحون من باقة بلس."}
                    </p>
                  </div>

                  <div className="grid gap-3 max-h-[360px] overflow-y-auto pr-1 scrollbar-thin">
                    {TEAM_PERSONAS.map((p: Persona) => {
                      const isAvailable = personaAvailableOnPlan(p.role, plan);
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
                                {isAvailable ? (
                                  <span className="text-[8px] font-mono font-bold bg-accent/10 text-accent border border-accent/20 rounded px-1.5 py-0.5">Included · مشمول</span>
                                ) : (
                                  <span className="text-[8px] font-mono font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20 rounded px-1.5 py-0.5">Upgrade · يتطلب ترقية</span>
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
                    <div className="flex justify-between gap-4 text-sm border-b border-rule/30 pb-2.5">
                      <span className="text-ink-mute">Store Name:</span>
                      <strong className="text-ink font-semibold" dir="auto">{businessName}</strong>
                    </div>
                    {vatNumber.trim() && (
                      <div className="flex justify-between gap-4 text-sm border-b border-rule/30 pb-2.5">
                        <span className="text-ink-mute">VAT Number:</span>
                        <strong className="text-ink font-semibold font-mono">{vatNumber.trim()}</strong>
                      </div>
                    )}
                    <div className="flex justify-between text-sm border-b border-rule/30 pb-2.5">
                      <span className="text-ink-mute">Selected Dialect:</span>
                      <strong className="text-ink font-semibold capitalize">{dialect}</strong>
                    </div>
                    <div className="flex justify-between gap-4 text-sm border-b border-rule/30 pb-2.5">
                      <span className="text-ink-mute">Subscription Tier:</span>
                      <strong className="text-accent font-semibold">
                        {selectedPlan.name} Plan · {selectedPlan.price} / month
                      </strong>
                    </div>
                    <div className="flex justify-between gap-4 text-sm">
                      <span className="text-ink-mute shrink-0">Included modules:</span>
                      <strong className="text-ink font-semibold font-arabic text-right" dir="rtl">
                        {includedModules.map((m) => m.ar).join(" · ")}
                      </strong>
                    </div>
                    <p className="text-[11px] text-ink-mute pt-1">
                      The plan activates once Moyasar confirms your payment. · تتفعّل الباقة بعد تأكيد الدفع عبر ميسر.
                    </p>
                  </div>

                  <label className="flex items-start gap-3 border border-rule/75 bg-paper/50 p-4 rounded-xl cursor-pointer hover:border-ink/30 transition">
                    <input
                      type="checkbox"
                      className="mt-1 accent-accent w-4 h-4"
                      checked={dpaAccepted}
                      onChange={(e) => setDpaAccepted(e.target.checked)}
                    />
                    <span className="text-xs text-ink-soft leading-relaxed">
                      <span className="block font-arabic text-right" dir="rtl">
                        أوافق على{" "}
                        <Link href="/legal/privacy" target="_blank" className="text-accent hover:underline font-semibold">
                          سياسة الخصوصية والشروط
                        </Link>{" "}
                        و
                        <Link href="/legal/dpa" target="_blank" className="text-accent hover:underline font-semibold">
                          اتفاقية معالجة البيانات
                        </Link>
                        ، وعلى معالجة البيانات عبر الحدود اللازمة وفق نظام حماية البيانات الشخصية السعودي.
                      </span>
                      <span className="block mt-1.5">
                        I accept the{" "}
                        <Link href="/legal/privacy" target="_blank" className="text-accent hover:underline font-semibold">
                          Privacy Policy & Terms
                        </Link>{" "}
                        and the{" "}
                        <Link href="/legal/dpa" target="_blank" className="text-accent hover:underline font-semibold">
                          Data Processing Agreement
                        </Link>
                        , and consent to the cross-border data processing required for GCC customer compliance under Saudi PDPL law.
                      </span>
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

                  {submitError && (
                    <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-400">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-arabic" dir="rtl">تعذّر حفظ بيانات متجرك. راجع البيانات وحاول مرة أخرى.</p>
                        <p className="mt-1">Could not save your store details: <span dir="auto">{submitError}</span></p>
                      </div>
                    </div>
                  )}
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
                      <Zap size={8} className="text-accent" /> Suggestions · اقتراحات
                    </p>

                    <div className="flex flex-col gap-2">
                      {step === 1 && (
                        <div className="p-3 bg-paper/60 border border-rule/50 rounded-xl text-[11px] leading-relaxed">
                          <p className="font-arabic text-ink-soft text-right" dir="rtl">
                            💡 استخدم الاسم الموجود في سجلك التجاري — يظهر هذا الاسم ورقمك الضريبي على فواتير زاتكا.
                          </p>
                          <p className="text-ink-mute mt-1">
                            Use the exact name on your Commercial Registration — it appears with your VAT number on ZATCA invoices.
                          </p>
                        </div>
                      )}

                      {step === 2 && (
                        <>
                          <button
                            type="button"
                            onClick={generateBrandKit}
                            disabled={!businessName.trim() || kitGenerating}
                            aria-busy={kitGenerating}
                            className="w-full py-2 px-3 bg-paper hover:bg-paper-deep text-ink border border-rule hover:border-accent/40 rounded-xl text-left font-semibold text-xs transition duration-300 flex items-center justify-between hover-lift shadow-glass-xs disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <span className="font-arabic font-normal text-ink-soft flex items-center gap-1.5">
                              {kitGenerating ? <RefreshCw size={12} className="animate-spin" /> : "✨"}
                              {kitGenerating ? "جاري التوليد بالذكاء الاصطناعي..." : "توليد الهوية وصوت العلامة بالذكاء الاصطناعي"}
                            </span>
                            <span className="font-mono text-[9px] text-ink-mute uppercase tracking-widest hidden sm:inline">
                              {kitGenerating ? "Generating…" : "AI Generate Voice"}
                            </span>
                          </button>
                          {kitError && (
                            <div role="alert" className="p-2.5 rounded-xl border border-red-500/25 bg-red-500/10 text-[11px] text-red-700 dark:text-red-400 leading-relaxed">
                              <p className="font-arabic text-right" dir="rtl">تعذّر توليد الهوية الآن — اكتبها يدوياً أو حاول مرة أخرى.</p>
                              <p className="mt-0.5">Could not generate a brand voice: <span dir="auto">{kitError}</span></p>
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={applyKsaTraditionalTraits}
                            className="w-full py-2 px-3 bg-paper hover:bg-paper-deep text-ink border border-rule hover:border-accent/40 rounded-xl text-left font-semibold text-xs transition duration-300 flex items-center justify-between hover-lift shadow-glass-xs"
                          >
                            <span className="font-arabic font-normal text-ink-soft">ضبط سمات تراثية سعودية أصيلة (قالب جاهز)</span>
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
                          <span className="font-arabic font-normal text-ink-soft">اختيار الباقة الموصى بها (بلس)</span>
                          <span className="font-mono text-[9px] text-ink-mute uppercase tracking-widest hidden sm:inline">Pick recommended</span>
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
                            disabled={!personaAvailableOnPlan("social", plan)}
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
                            disabled={!personaAvailableOnPlan("voice", plan)}
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
                            disabled={!personaAvailableOnPlan("seo", plan)}
                            className="py-2 px-1 bg-paper hover:bg-paper-deep text-ink border border-rule hover:border-accent/40 rounded-lg text-center font-arabic text-[10px] transition duration-300 truncate hover-lift disabled:opacity-20 disabled:cursor-not-allowed"
                          >
                            🔍 لمياء (سيو)
                          </button>
                        </div>
                      )}

                      {step === 5 && (
                        <Link
                          href="/legal/dpa"
                          target="_blank"
                          className="w-full py-2 px-3 bg-paper hover:bg-paper-deep text-ink border border-rule hover:border-accent/40 rounded-xl text-left font-semibold text-xs transition duration-300 flex items-center justify-between hover-lift shadow-glass-xs"
                        >
                          <span className="font-arabic font-normal text-ink-soft">📄 اقرأ اتفاقية معالجة البيانات قبل الموافقة</span>
                          <span className="font-mono text-[9px] text-ink-mute uppercase tracking-widest hidden sm:inline">Read the DPA</span>
                        </Link>
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
