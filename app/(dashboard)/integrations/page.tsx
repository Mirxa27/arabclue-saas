import { Topbar } from "@/components/dashboard/topbar";
import { IntegrationsPanel } from "@/components/dashboard/integrations-panel";
import { getCurrentMerchant } from "@/lib/auth/session";
import { buildAuthorizeURL } from "@/lib/salla/oauth";
import { getServerSupabase } from "@/lib/db/supabase";

export default async function IntegrationsPage() {
  const merchant = await getCurrentMerchant();
  const supabase = getServerSupabase();

  const sallaInstallURL = buildAuthorizeURL({
    clientId: process.env.SALLA_CLIENT_ID ?? "",
    redirectUri: process.env.SALLA_REDIRECT_URI ?? "",
    state: merchant?.id ?? "anon",
    scope: "offline_access products.read orders.read settings.read"
  });

  const channelStatus: Record<string, boolean> = {};
  if (merchant) {
    const { data: channels } = await supabase
      .from("social_channels")
      .select("platform")
      .eq("merchant_id", merchant.id);
    for (const row of channels ?? []) {
      channelStatus[row.platform] = true;
    }
  }

  return (
    <>
      <Topbar merchant={merchant} title="Integrations" />
      <IntegrationsPanel
        sallaInstallURL={sallaInstallURL}
        sallaConnected={!!merchant?.access_token}
        channelStatus={channelStatus}
      />
    </>
  );
}
