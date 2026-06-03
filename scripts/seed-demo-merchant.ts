/**
 * Runnable demo seed: `npm run db:seed`.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the
 * environment. Creates the service-role client directly (no `@/` alias) so it
 * runs cleanly under tsx, then delegates to the tested seedDemoMerchant logic.
 */
import { createClient } from "@supabase/supabase-js";
import { seedDemoMerchant, DEMO_EMAIL } from "../lib/demo/seed";

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running the seed.");
  }

  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await seedDemoMerchant(client);

  console.log(`✓ Demo merchant ready (${result.created ? "new" : "existing"} user): ${DEMO_EMAIL}`);
  console.log(`  merchant id: ${result.merchantId}`);
}

main().catch((err) => {
  console.error("✗ Demo seed failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
