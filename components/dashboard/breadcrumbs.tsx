"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ChevronRight, Home } from "lucide-react";

type BreadcrumbSegment = {
  label: string;
  href?: string;
};

const ROUTE_LABELS: Record<string, string> = {
  dashboard: "الرئيسية",
  social: "التواصل الاجتماعي",
  voice: "المساعد الصوتي",
  seo: "تحسين محركات البحث",
  brand: "هوية العلامة التجارية",
  invoices: "الفواتير",
  employees: "الموظفين",
  billing: "الاشتراك والفوترة",
  marketplace: "السوق",
  settings: "الإعدادات",
  integrations: "الربط والتكامل",
};

function parseRouteLabels(path: string): BreadcrumbSegment[] {
  const segments = path.split("/").filter(Boolean);
  const breadcrumbs: BreadcrumbSegment[] = [];
  let accumulated = "";

  for (const segment of segments) {
    accumulated += `/${segment}`;
    const label = ROUTE_LABELS[segment] ?? segment.charAt(0).toUpperCase() + segment.slice(1);
    breadcrumbs.push({
      label,
      href: accumulated,
    });
  }

  return breadcrumbs;
}

export function Breadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname();
  const segments = parseRouteLabels(pathname);

  if (segments.length <= 1) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        "flex items-center gap-1 text-[11px] sm:text-xs font-sans text-ink-mute px-3 sm:px-5 lg:px-8 pt-2",
        className,
      )}
    >
      <Link
        href="/dashboard"
        className="flex items-center gap-1 hover:text-accent transition-colors duration-200"
        aria-label="Dashboard home"
      >
        <Home size={13} strokeWidth={2} />
      </Link>

      {segments.slice(0, -1).map((segment, i) => (
        <span key={segment.href} className="flex items-center gap-1">
          <ChevronRight size={11} strokeWidth={2.5} className="text-rule" />
          {segment.href ? (
            <Link
              href={segment.href}
              className="hover:text-ink transition-colors duration-200 line-clamp-1 max-w-[120px]"
            >
              {segment.label}
            </Link>
          ) : (
            <span className="line-clamp-1 max-w-[120px]">{segment.label}</span>
          )}
        </span>
      ))}

      {/* Current page — last segment */}
      {segments.length > 0 && (
        <>
          <ChevronRight size={11} strokeWidth={2.5} className="text-rule" />
          <span
            className="text-ink font-semibold line-clamp-1 max-w-[140px]"
            aria-current="page"
          >
            {segments[segments.length - 1].label}
          </span>
        </>
      )}
    </nav>
  );
}