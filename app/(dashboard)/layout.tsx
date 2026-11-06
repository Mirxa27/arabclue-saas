import { requireUser, getCurrentMerchant } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/auth/admin";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { DashboardChrome } from "@/components/dashboard/dashboard-chrome";
import { DpaReacceptBanner } from "@/components/legal/dpa-reaccept-banner";
import { CURRENT_DPA_VERSION, merchantNeedsDpaAcceptance } from "@/lib/legal/dpa";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const [showAdminLink, merchant] = await Promise.all([isPlatformAdmin(), getCurrentMerchant()]);
  const needsDpa = merchantNeedsDpaAcceptance(merchant);
  return (
    <ErrorBoundary>
      <DashboardChrome showAdminLink={showAdminLink}>
        {needsDpa && <DpaReacceptBanner version={CURRENT_DPA_VERSION} />}
        {children}
      </DashboardChrome>
    </ErrorBoundary>
  );
}
