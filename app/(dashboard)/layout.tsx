import { requireUser } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/auth/admin";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { DashboardChrome } from "@/components/dashboard/dashboard-chrome";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const showAdminLink = await isPlatformAdmin();
  return (
    <ErrorBoundary>
      <DashboardChrome showAdminLink={showAdminLink}>{children}</DashboardChrome>
    </ErrorBoundary>
  );
}
