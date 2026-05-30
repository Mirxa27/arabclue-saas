import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageIntro({
  kicker,
  title,
  description,
  descriptionAr,
  actions,
  className,
}: {
  kicker?: string;
  title: ReactNode;
  description?: string;
  descriptionAr?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        "pb-1 border-b border-rule/25",
        className,
      )}
    >
      <div className="max-w-2xl space-y-2">
        {kicker && (
          <p className="marker-numeral">{kicker}</p>
        )}
        <h2 className="display-2 text-ink">{title}</h2>
        {description && (
          <p className="text-sm leading-relaxed text-ink-soft">{description}</p>
        )}
        {descriptionAr && (
          <p className="font-arabic text-sm leading-relaxed text-ink-mute" dir="rtl">
            {descriptionAr}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
