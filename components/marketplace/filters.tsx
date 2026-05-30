"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";
import { useRef } from "react";

export function MarketplaceFilters({
  initialQuery,
  initialCategory,
  categories,
}: {
  initialQuery: string;
  initialCategory: string;
  categories: Array<{ id: string; label: string; arabic: string; emoji: string }>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);

  function apply(q: string, category: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (q) params.set("q", q);
    else params.delete("q");
    if (category && category !== "all") params.set("category", category);
    else params.delete("category");
    router.push(`/marketplace?${params.toString()}`);
  }

  return (
    <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
      {/* Search */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply(inputRef.current?.value ?? "", initialCategory);
        }}
        className="flex items-center gap-2 w-full max-w-sm"
      >
        <div className="relative flex-1">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute pointer-events-none"
          />
          <input
            ref={inputRef}
            defaultValue={initialQuery}
            placeholder="Search roles or skills…"
            className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-rule/50 bg-paper/50 text-sm text-ink placeholder:text-ink-mute/60 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition"
          />
          {initialQuery && (
            <button
              type="button"
              onClick={() => apply("", initialCategory)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-mute hover:text-ink transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <Button type="submit" size="sm" variant="primary">
          Search
        </Button>
      </form>

      {/* Category pills */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => apply(initialQuery, "all")}
          className={`px-3 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-wider border transition-all ${
            initialCategory === "all"
              ? "bg-accent text-paper border-accent"
              : "border-rule/50 text-ink-soft hover:border-accent/40 hover:text-ink"
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => apply(initialQuery, cat.id)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-wider border transition-all ${
              initialCategory === cat.id
                ? "bg-accent text-paper border-accent"
                : "border-rule/50 text-ink-soft hover:border-accent/40 hover:text-ink"
            }`}
          >
            {cat.emoji} {cat.label}
          </button>
        ))}
      </div>
    </div>
  );
}