"use client";

import { Suspense, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/dashboard/sidebar";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { DashboardCommandPalette } from "@/components/dashboard/dashboard-command-palette";
import { AdminAccessDenied } from "@/components/dashboard/admin-access-denied";
import { Breadcrumbs } from "@/components/dashboard/breadcrumbs";
import { SupportForm } from "@/components/dashboard/support-form";
import { FeedbackWidget } from "@/components/dashboard/feedback-widget";

type DashboardChromeProps = {
  children: ReactNode;
  showAdminLink?: boolean;
};

export function DashboardChrome({ children, showAdminLink = false }: DashboardChromeProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const isDashboardHome = pathname === "/dashboard";

  return (
    <div className="dashboard-shell min-h-screen">
      <Sidebar
        showAdminLink={showAdminLink}
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
      />

      <main className="relative z-10 flex min-h-screen min-w-0 flex-1 flex-col transition-[padding] duration-300 ease-spring pb-[calc(5.75rem+var(--safe-bottom))] lg:pb-0">
        <Suspense fallback={null}>
          <AdminAccessDenied />
        </Suspense>

        {/* Breadcrumbs — hidden on dashboard home */}
        {!isDashboardHome && <Breadcrumbs />}

        {children}
      </main>

      <div className="lg:hidden">
        <MobileNav showAdminLink={showAdminLink} />
      </div>

      <DashboardCommandPalette showAdminLink={showAdminLink} />

      {/* Floating UX widgets */}
      <SupportForm />
      <FeedbackWidget />
    </div>
  );
}
