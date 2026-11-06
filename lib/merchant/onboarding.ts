/**
 * Server side of the /welcome wizard: create or update the signed-in user's merchant
 * profile and brand kit.
 *
 * Runs on the service role because merchants is not insertable through the Data API
 * (F01: browser writes let a merchant set its own plan). New merchants always start on
 * plan 'lite' with subscription 'pending'; existing merchants keep their plan and
 * subscription untouched — those change only through Moyasar confirmation.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/api/errors";
import { assertNoDbError, isUniqueViolation } from "@/lib/db/errors";
import { CURRENT_DPA_VERSION } from "@/lib/legal/dpa";
import type { OnboardingInput } from "@/lib/merchant/onboarding-schema";

export type OnboardingResult = { merchantId: string; created: boolean };

const ROUTE = "POST /api/merchant/onboarding";

async function findMerchantId(sb: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await sb
    .from("merchants")
    .select("id")
    .eq("owner_user_id", userId)
    .limit(1)
    .maybeSingle();
  assertNoDbError(error, "Load merchant profile", { route: ROUTE, code: "onboarding_failed" });
  return (data as { id: string } | null)?.id ?? null;
}

async function updateProfile(sb: SupabaseClient, merchantId: string, profile: Record<string, unknown>) {
  const { error } = await sb.from("merchants").update(profile).eq("id", merchantId);
  assertNoDbError(error, "Update merchant profile", { route: ROUTE, merchantId, code: "onboarding_failed" });
}

export async function completeOnboarding(
  sb: SupabaseClient,
  userId: string,
  input: OnboardingInput,
  now: Date = new Date()
): Promise<OnboardingResult> {
  const profile = {
    seller_name: input.businessName,
    vat_number: input.vatNumber ? input.vatNumber : null,
    dpa_accepted_at: now.toISOString(),
    dpa_version: CURRENT_DPA_VERSION
  };

  let merchantId = await findMerchantId(sb, userId);
  let created = false;

  if (merchantId) {
    await updateProfile(sb, merchantId, profile);
  } else {
    const { data, error } = await sb
      .from("merchants")
      .insert({ owner_user_id: userId, plan: "lite", subscription_status: "pending", ...profile })
      .select("id")
      .single();

    if (isUniqueViolation(error)) {
      // A concurrent submit (double click, second tab) created the row first.
      merchantId = await findMerchantId(sb, userId);
      if (!merchantId) throw new HttpError(409, "Onboarding is already in progress — try again", "onboarding_conflict");
      await updateProfile(sb, merchantId, profile);
    } else {
      assertNoDbError(error, "Create merchant profile", { route: ROUTE, code: "onboarding_failed" });
      merchantId = (data as { id: string } | null)?.id ?? null;
      if (!merchantId) throw new HttpError(500, "Create merchant profile failed", "onboarding_failed");
      created = true;
    }
  }

  // brand_kits has one row per merchant (UI-006). Blank voice fields leave an existing
  // kit's essence/attributes untouched instead of wiping them on a re-run.
  const kit: Record<string, unknown> = {
    merchant_id: merchantId,
    brand_name: input.businessName,
    dialect: input.brandKit.dialect,
    updated_at: now.toISOString()
  };
  if (input.brandKit.essence) kit.essence = input.brandKit.essence;
  if (input.brandKit.attributes.length) kit.attributes = input.brandKit.attributes;

  const { error: kitErr } = await sb.from("brand_kits").upsert(kit, { onConflict: "merchant_id" });
  assertNoDbError(kitErr, "Save brand kit", { route: ROUTE, merchantId, code: "onboarding_failed" });

  return { merchantId, created };
}
