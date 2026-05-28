import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      className={cn("text-ink", className)}
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden
    >
      <rect x="0.5" y="0.5" width="27" height="27" rx="3" stroke="currentColor" strokeOpacity="0.18" />
      <path d="M7 18.5L14 7L21 18.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="14" cy="20.5" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function LogoFull({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="font-display text-[22px] tracking-tightest leading-none">arabclue</span>
    </div>
  );
}
