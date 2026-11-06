"use client";

/**
 * ZATCA e-invoicing onboarding card (UI-024): OTP from the FATOORA portal → compliance CSID → the
 * six compliance checks → production CSID, with the progress and ZATCA's own messages. Talks only to
 * GET/POST /api/zatca/onboard; key material never reaches the browser.
 */
import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, CircleDashed, CircleX, KeyRound, ShieldCheck } from "lucide-react";
import { Card, CardSubtitle, CardTitle, Field, Input } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

type Message = { code?: string; category?: string; message?: string };
type Check = { kind: string; status: "passed" | "failed" | "pending"; warnings: Message[]; errors: Message[] };
type Status = {
  configured: boolean;
  environment: "sandbox" | "simulation" | "production" | null;
  environmentMismatch: boolean;
  onboarded: boolean;
  step: "not_started" | "compliance_csid" | "compliance_checks" | "production_csid" | "active";
  next: "start" | "resume" | "none";
  egsSerialNumber: string | null;
  certificate: { serialNumber: string | null; issuer: string | null; expiresAt: string | null } | null;
  checks: Check[];
  lastError: { code: string; message: string; details?: Message[] } | null;
  onboardedAt: string | null;
};
type Access = { ok: true } | { ok: false; reason: string; message: string };

const CHECK_LABELS: Record<string, { en: string; ar: string }> = {
  standard_invoice: { en: "Standard tax invoice", ar: "فاتورة ضريبية" },
  standard_credit_note: { en: "Standard credit note", ar: "إشعار دائن" },
  standard_debit_note: { en: "Standard debit note", ar: "إشعار مدين" },
  simplified_invoice: { en: "Simplified tax invoice", ar: "فاتورة ضريبية مبسطة" },
  simplified_credit_note: { en: "Simplified credit note", ar: "إشعار دائن مبسط" },
  simplified_debit_note: { en: "Simplified debit note", ar: "إشعار مدين مبسط" }
};

function StepIcon({ state }: { state: "done" | "failed" | "todo" }) {
  if (state === "done") return <BadgeCheck size={16} className="text-accent" />;
  if (state === "failed") return <CircleX size={16} className="text-red-500" />;
  return <CircleDashed size={16} className="text-ink-mute" />;
}

export function ZatcaOnboardingCard({ vatNumber }: { vatNumber: string | null }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [otp, setOtp] = useState("");
  const [branchName, setBranchName] = useState("");
  const [industry, setIndustry] = useState("");
  const [groupMemberTin, setGroupMemberTin] = useState("");
  const [restartOpen, setRestartOpen] = useState(false);
  const isGroup = Boolean(vatNumber && vatNumber.length === 15 && vatNumber[10] === "1");

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/zatca/onboard", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { status?: Status; access?: Access; error?: string };
      if (!res.ok || !body.status) throw new Error(body.error ?? "Could not load the ZATCA status");
      setStatus(body.status);
      setAccess(body.access ?? null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load the ZATCA status");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(mode: "start" | "resume" | "restart") {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      if (mode !== "resume") payload.otp = otp.trim();
      if (mode === "restart") payload.restart = true;
      if (branchName.trim()) payload.branchName = branchName.trim();
      if (industry.trim()) payload.industry = industry.trim();
      if (isGroup && groupMemberTin.trim()) payload.groupMemberTin = groupMemberTin.trim();
      const res = await fetch("/api/zatca/onboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = (await res.json().catch(() => ({}))) as { status?: Status; error?: string; code?: string; pending?: { invoiced?: number } | null };
      if (!res.ok || !body.status) {
        setError({ message: body.error ?? "Onboarding failed / تعذر التسجيل", code: body.code });
        return;
      }
      setStatus(body.status);
      setOtp("");
      setRestartOpen(false);
      if (body.status.onboarded) {
        toast("ZATCA onboarding complete / اكتمل التسجيل في زاتكا", "success");
        if (body.pending?.invoiced) toast(`${body.pending.invoiced} waiting order(s) invoiced / فواتير صدرت للطلبات المعلقة`, "success");
      } else if (body.status.lastError) {
        toast("A ZATCA step failed — see below / فشلت خطوة", "error");
      }
    } catch {
      setError({ message: "Network error / خطأ في الشبكة" });
    } finally {
      setBusy(false);
    }
  }

  const checksDone = status?.checks.length ? status.checks.every((c) => c.status === "passed") : false;
  const checksFailed = status?.checks.some((c) => c.status === "failed") ?? false;
  const stepState = (step: 1 | 2 | 3): "done" | "failed" | "todo" => {
    if (!status || status.step === "not_started") return "todo";
    if (step === 1) return "done";
    if (step === 2) return checksDone || status.step === "production_csid" || status.step === "active" ? "done" : checksFailed ? "failed" : "todo";
    return status.step === "active" ? "done" : status.step === "production_csid" && status.lastError ? "failed" : "todo";
  };
  const otpValid = /^[0-9٠-٩]{6}$/.test(otp.trim());
  const blocked = access && !access.ok ? access : null;

  return (
    <Card>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
          <ShieldCheck size={16} />
        </div>
        <div>
          <CardTitle>ZATCA e-invoicing onboarding</CardTitle>
          <CardSubtitle>
            Connect this store to FATOORA so every invoice is signed and reported. <span dir="rtl">ربط المتجر بمنصة فاتورة لتوقيع الفواتير والإبلاغ عنها.</span>
          </CardSubtitle>
        </div>
      </div>

      {loadError && <p className="text-sm text-red-500">{loadError}</p>}
      {!status && !loadError && <p className="text-sm text-ink-mute">Loading… / جارٍ التحميل</p>}

      {status && (
        <div className="space-y-5">
          {!status.configured && (
            <p className="text-sm text-ink-soft">
              ZATCA is not configured on this platform yet. <span dir="rtl">لم يتم إعداد الربط مع زاتكا على المنصة بعد.</span>
            </p>
          )}
          {blocked && status.configured && (
            <div className="rounded-xl border border-accent-warm/30 bg-accent-warm/5 p-3 text-sm text-ink">
              <p>{blocked.message}</p>
              {blocked.reason === "not_entitled" && (
                <a className="text-accent underline text-xs" href="/billing">
                  Activate your subscription / تفعيل الاشتراك
                </a>
              )}
            </div>
          )}
          {status.environment && status.environment !== "production" && (
            <p className="text-xs text-accent-warm-deep">
              ZATCA {status.environment} environment — documents are test documents.
              {status.environment === "sandbox" && (
                <>
                  {" "}
                  Developer-portal sandbox: OTP <span className="font-mono">123345</span>; its production certificate only accepts VAT{" "}
                  <span className="font-mono">399999999900003</span>.
                </>
              )}{" "}
              <span dir="rtl">بيئة اختبار لدى زاتكا.</span>
            </p>
          )}
          {status.environmentMismatch && (
            <p className="text-xs text-accent-warm-deep">
              The saved ZATCA unit belongs to another environment — onboard again. <span dir="rtl">الوحدة المسجلة تخص بيئة أخرى — أعد التسجيل.</span>
            </p>
          )}

          <ol className="space-y-3 text-sm">
            <li className="flex items-start gap-2">
              <StepIcon state={stepState(1)} />
              <div>
                <p className="text-ink">1. Compliance certificate (OTP) <span dir="rtl" className="text-ink-mute">· شهادة الامتثال</span></p>
              </div>
            </li>
            <li className="flex items-start gap-2">
              <StepIcon state={stepState(2)} />
              <div className="flex-1">
                <p className="text-ink">2. Compliance checks <span dir="rtl" className="text-ink-mute">· فحوص الامتثال</span></p>
                {status.checks.length > 0 && (
                  <ul className="mt-1 grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {status.checks.map((c) => (
                      <li key={c.kind} className="flex items-start gap-1.5">
                        <StepIcon state={c.status === "passed" ? "done" : c.status === "failed" ? "failed" : "todo"} />
                        <span>
                          {CHECK_LABELS[c.kind]?.en ?? c.kind} <span dir="rtl" className="text-ink-mute">· {CHECK_LABELS[c.kind]?.ar}</span>
                          {c.errors.map((e, i) => (
                            <span key={i} className="block text-red-500" dir="auto">
                              {e.code}: {e.message}
                            </span>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
            <li className="flex items-start gap-2">
              <StepIcon state={stepState(3)} />
              <div>
                <p className="text-ink">3. Production certificate <span dir="rtl" className="text-ink-mute">· شهادة الإنتاج</span></p>
                {status.onboarded && status.certificate && (
                  <p className="text-xs text-ink-mute">
                    Serial {status.certificate.serialNumber} · expires {status.certificate.expiresAt ? new Date(status.certificate.expiresAt).toLocaleDateString("en-GB") : "—"}
                  </p>
                )}
              </div>
            </li>
          </ol>

          {status.lastError && (
            <div className="rounded-xl border border-red-400/40 bg-red-500/5 p-3 text-xs text-ink" dir="auto">
              <p className="font-semibold">{status.lastError.message}</p>
              {status.lastError.details?.slice(0, 6).map((d, i) => (
                <p key={i} className="text-red-500">
                  {d.category ? `${d.category} — ` : ""}
                  {d.code}: {d.message}
                </p>
              ))}
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-red-400/40 bg-red-500/5 p-3 text-xs text-ink" dir="auto">
              <p>{error.message}</p>
              {error.code === "tax_profile_incomplete" && (
                <p className="mt-1 text-ink-mute">
                  Fill in the ZATCA tax details above and save them first. <span dir="rtl">أكمل بيانات الضريبة أعلاه واحفظها أولاً.</span>
                </p>
              )}
              {error.code === "plan_required" && (
                <a className="text-accent underline" href="/billing">
                  Activate your subscription / تفعيل الاشتراك
                </a>
              )}
            </div>
          )}

          {status.onboarded ? (
            <div className="space-y-3">
              <p className="text-sm text-accent-deep flex items-center gap-2">
                <BadgeCheck size={16} /> Onboarded {status.onboardedAt ? new Date(status.onboardedAt).toLocaleDateString("en-GB") : ""} —
                invoices are signed and reported automatically. <span dir="rtl">مسجّل — تُوقّع الفواتير ويُبلّغ عنها تلقائياً.</span>
              </p>
              <button type="button" className="text-xs text-ink-mute underline" onClick={() => setRestartOpen((v) => !v)}>
                Replace the ZATCA certificate (new OTP) / استبدال الشهادة
              </button>
            </div>
          ) : null}

          {status.configured && !blocked && (status.next !== "none" || restartOpen) && (
            <div className="space-y-4 border-t border-rule/30 pt-4">
              {status.next === "resume" && !restartOpen && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" onClick={() => submit("resume")} disabled={busy}>
                    {busy ? "Working… / جارٍ التنفيذ" : "Resume onboarding / متابعة التسجيل"}
                  </Button>
                  <button type="button" className="text-xs text-ink-mute underline" onClick={() => setRestartOpen(true)}>
                    Start over with a new OTP / البدء من جديد
                  </button>
                </div>
              )}
              {(status.next === "start" || restartOpen) && (
                <>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="FATOORA one-time password (OTP) / رمز التحقق" hint="6 digits from fatoora.zatca.gov.sa">
                      <Input
                        value={otp}
                        onChange={(e) => setOtp(e.target.value)}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder="123456"
                      />
                    </Field>
                    <Field label="Branch name / اسم الفرع" hint="Optional — defaults to your store name">
                      <Input value={branchName} onChange={(e) => setBranchName(e.target.value)} maxLength={64} dir="auto" />
                    </Field>
                    <Field label="Industry / النشاط" hint="Optional — e.g. Retail, E-commerce">
                      <Input value={industry} onChange={(e) => setIndustry(e.target.value)} maxLength={100} dir="auto" />
                    </Field>
                    {isGroup && (
                      <Field label="Group member TIN / الرقم المميز لعضو المجموعة" hint="VAT group: 10-digit TIN">
                        <Input value={groupMemberTin} onChange={(e) => setGroupMemberTin(e.target.value)} inputMode="numeric" maxLength={10} />
                      </Field>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <KeyRound size={14} className="text-ink-mute" />
                    <Button type="button" onClick={() => submit(restartOpen ? "restart" : "start")} disabled={busy || !otpValid}>
                      {busy ? "Onboarding… / جارٍ التسجيل" : restartOpen ? "Onboard again / إعادة التسجيل" : "Start onboarding / بدء التسجيل"}
                    </Button>
                    {restartOpen && (
                      <button type="button" className="text-xs text-ink-mute underline" onClick={() => setRestartOpen(false)}>
                        Cancel / إلغاء
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-ink-mute">
                    Generate the OTP in the FATOORA portal (Onboard new solution unit). A new signing key is created on our server; it never leaves it.{" "}
                    <span dir="rtl">أنشئ رمز التحقق من بوابة فاتورة. يُنشأ مفتاح التوقيع على خوادمنا ولا يغادرها.</span>
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
