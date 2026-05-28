"use client";

import type { ReactNode } from "react";
import { Topbar } from "@/components/dashboard/topbar";
import { PageSkeleton } from "@/components/ui/skeleton";
import type { Merchant } from "@/lib/types/database";

export function PageShell({
  title,
  merchant,
  loading,
  children
}: {
  title: string;
  merchant: Merchant | null;
  loading: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <Topbar merchant={merchant} title={title} />
      {loading ? <PageSkeleton title={title} /> : children}
    </>
  );
}
