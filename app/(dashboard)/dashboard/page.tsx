import { PageShell } from "@/components/dashboard/page-shell";
import { OverviewView } from "@/components/dashboard/overview-view";
import { getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase, getServiceSupabase } from "@/lib/db/supabase";
import { loadOverview } from "@/lib/dashboard/overview";

export const dynamic = "force-dynamic";

/**
 * Overview: every KPI, health check and plan line is loaded from the merchant's real rows on the
 * server (lib/dashboard/overview.ts) and rendered by the client view.
 */
export default async function DashboardPage() {
  const merchant = await getCurrentMerchant();
  const overview = await loadOverview({
    merchant,
    userClient: await getServerSupabase(),
    serviceClient: merchant ? getServiceSupabase() : null,
  });

  return (
    <PageShell title="Overview" merchant={merchant}>
      <OverviewView overview={overview} />
    </PageShell>
  );
}
