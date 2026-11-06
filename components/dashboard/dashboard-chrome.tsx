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
import { useTextEntryFocus } from "@/hooks/use-text-entry-focus";

type DashboardChromeProps = {
  children: ReactNode;
  showAdminLink?: boolean;
};

export function DashboardChrome({ children, showAdminLink = false }: DashboardChromeProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const pathname = usePathname();
  const isDashboardHome = pathname === "/dashboard";
  // While the on-screen keyboard is up (a text field has focus on a touch device) the tab bar
  // and the floating launchers slide away; `data-text-entry` also zeroes --nav-inset so open
  // panels drop onto the keyboard instead of floating a tab bar's height above it.
  const textEntry = useTextEntryFocus();

  return (
    // `.dashboard-shell` already sets min-height: 100dvh (VH-01: `min-h-screen` here
    // overrode it with 100vh from the utilities layer).
    <div className="dashboard-shell" data-text-entry={textEntry ? "true" : undefined}>
      <Sidebar
        showAdminLink={showAdminLink}
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
      />

      {/*
        No z-index on <main> (STACK-01): it made <main> a stacking context that capped every
        page overlay under the tab bar and the floating chrome. The mobile bottom padding
        clears the tab bar plus the floating launchers (they end 8.25rem + safe area up).
      */}
      <main className="relative flex min-h-dvh min-w-0 flex-1 flex-col transition-[padding] duration-300 ease-spring pb-[calc(9rem+var(--safe-bottom))] lg:pb-0">
        <Suspense fallback={null}>
          <AdminAccessDenied />
        </Suspense>

        {/* Breadcrumbs — hidden on dashboard home */}
        {!isDashboardHome && <Breadcrumbs />}

        {children}
      </main>

      <div className="lg:hidden">
        <MobileNav showAdminLink={showAdminLink} hidden={textEntry} />
      </div>

      <DashboardCommandPalette showAdminLink={showAdminLink} />

      {/*
        Floating UX widgets in one dock, so the feedback launcher sits beside the support
        launcher (not stacked over page content) above the tab bar / keyboard / home indicator.
        Their open panels are position:fixed on the same z-50 layer.
      */}
      <div
        data-testid="chrome-fab-dock"
        className="fixed bottom-[calc(0.75rem+var(--chrome-bottom))] end-[calc(1.5rem+var(--chrome-side))] z-50 flex items-end gap-2 lg:bottom-6"
      >
        <FeedbackWidget hidden={supportOpen} launcherHidden={textEntry} />
        <SupportForm open={supportOpen} onOpenChange={setSupportOpen} launcherHidden={textEntry} />
      </div>
    </div>
  );
}
