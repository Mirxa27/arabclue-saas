/**
 * Runnable demo seed: `npm run db:seed`.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the
 * environment. Optional: DEMO_MERCHANT_EMAIL, DEMO_MERCHANT_PASSWORD (≥ 12 chars),
 * DEMO_MERCHANT_DAYS (subscription length, default 30). Creates the service-role
 * client directly (no `@/` alias) so it runs cleanly under tsx, then delegates to
 * the tested seedDemoMerchant logic.
 *
 * A generated password is printed exactly once, on the run that creates the user.
 */
import { createClient } from "@supabase/supabase-js";
import { seedDemoMerchant, demoSeedOptionsFromEnv, DEMO_EMAIL } from "../lib/demo/seed";

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running the seed.");
  }

  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const options = demoSeedOptionsFromEnv();
  const result = await seedDemoMerchant(client, options);

  console.log(`✓ Demo merchant ready (${result.created ? "new" : "existing"} user): ${options.email ?? DEMO_EMAIL}`);
  console.log(`  merchant id: ${result.merchantId}`);
  console.log(`  Pro subscription active until ${result.subscriptionExpiresAt}`);
  if (result.generatedPassword) {
    console.log(`  generated password (shown once — store it safely): ${result.generatedPassword}`);
  } else if (result.passwordUpdated) {
    console.log("  password set from DEMO_MERCHANT_PASSWORD");
  } else if (!result.created) {
    console.log("  password unchanged (set DEMO_MERCHANT_PASSWORD to replace it)");
  }
}

main().catch((err) => {
  console.error("✗ Demo seed failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
