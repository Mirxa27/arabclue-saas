import { cn } from "@/lib/utils";

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={cn("animate-shimmer rounded-xl bg-ink/6", className)}
      style={style}
      aria-hidden
    />
  );
}

/** Glass card skeleton — mimics the dashboard card layout */
export function GlassCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-rule/15 bg-glass backdrop-blur-glass p-5 space-y-4",
        className
      )}
      aria-hidden
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-3 w-3 rounded-full" />
      </div>
      <Skeleton className="h-10 w-20" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}

/** Dashboard page loading state */
export function PageSkeleton({ title }: { title: string }) {
  return (
    <div
      className="p-4 md:p-6 lg:p-8 space-y-8"
      aria-busy
      aria-label={`Loading ${title}`}
    >
      {/* Hero row */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Skeleton className="h-10 w-32 rounded-xl" />
      </div>
      {/* Stat cards */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <GlassCardSkeleton />
        <GlassCardSkeleton />
        <GlassCardSkeleton />
        <GlassCardSkeleton />
      </div>
      {/* Content area */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl border border-rule/15 bg-glass backdrop-blur-glass p-5">
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border border-rule/15 bg-glass backdrop-blur-glass p-5 space-y-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Inline skeleton for small content placeholders (e.g., inside cards) */
export function InlineSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: `${80 - i * 15}%` }}
        />
      ))}
    </div>
  );
}