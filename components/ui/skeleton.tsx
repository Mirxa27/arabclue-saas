import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-sm bg-ink/8", className)}
      aria-hidden
    />
  );
}

export function PageSkeleton({ title }: { title: string }) {
  return (
    <div className="p-8 space-y-6" aria-busy aria-label={`Loading ${title}`}>
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
