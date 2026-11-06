import { cn } from "@/lib/utils";

/** Fixed bilingual status line for the sign-in pages (Arabic first, then English). */
export function AuthMessage({
  tone,
  text,
  className,
}: {
  tone: "error" | "success";
  text: { ar: string; en: string };
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-xl border px-4 py-3 text-sm leading-relaxed space-y-1",
        tone === "error"
          ? "border-accent-warm/40 bg-accent-warm/5 text-accent-warm-deep"
          : "border-accent/30 bg-accent/5 text-accent-deep",
        className
      )}
    >
      <p className="font-arabic" dir="rtl" lang="ar">
        {text.ar}
      </p>
      <p>{text.en}</p>
    </div>
  );
}
