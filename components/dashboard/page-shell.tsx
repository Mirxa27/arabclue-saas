"use client";

import type { ReactNode } from "react";
import { Topbar } from "@/components/dashboard/topbar";
import { PageSkeleton } from "@/components/ui/skeleton";
import type { Merchant } from "@/lib/types/database";

export function PageShell({
  title,
  merchant,
  loading,
  children,
}: {
  title: ReactNode;
  merchant: Merchant | null;
  loading?: boolean;
  children: ReactNode;
}) {
  const titleLabel = typeof title === "string" ? title : "page";

  return (
    <div className="flex flex-col min-h-full">
      <Topbar merchant={merchant} title={title} />
      <div className="flex-1 w-full px-4 sm:px-6 lg:px-8 2xl:px-10 py-5 sm:py-6 lg:py-8">
        <div className="dashboard-content-glass mx-auto w-full max-w-[1680px] p-4 sm:p-5 lg:p-7">
        {loading ? <PageSkeleton title={titleLabel} /> : children}
        </div>
      </div>
    </div>
  );
}