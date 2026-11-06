/**
 * The notifications read cursor (merchant_notification_state), moved forward through the
 * mark_notifications_seen RPC with the merchant's own session — RLS refuses another merchant.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { assertNoDbError } from "@/lib/db/errors";

export const MarkSeenBodySchema = z.object({
  up_to: z.iso.datetime({ offset: true }).optional()
});

export async function markNotificationsSeen(userClient: SupabaseClient, merchantId: string, upTo: string | null): Promise<string | null> {
  const { data, error } = await userClient.rpc("mark_notifications_seen", {
    p_merchant_id: merchantId,
    p_up_to: upTo
  });
  assertNoDbError(error, "Mark notifications read", { route: "POST /api/notifications/read", merchantId });
  return typeof data === "string" ? data : null;
}
