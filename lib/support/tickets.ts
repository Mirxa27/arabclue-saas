/**
 * Support tickets and in-app feedback (public.support_tickets / public.user_feedback).
 *
 * Both tables are written by the server on the service role after the route has
 * authenticated the user; a failed insert is an error (5xx), never a fake success.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { HttpError } from "@/lib/api/errors";
import { assertNoDbError } from "@/lib/db/errors";
import type { SupportCategory } from "@/lib/support/notify";

export const SUPPORT_CATEGORIES = ["help", "bug", "feature", "billing"] as const satisfies readonly SupportCategory[];

export const SupportBodySchema = z.object({
  category: z.enum(SUPPORT_CATEGORIES),
  message: z.string().trim().min(5).max(5000),
  /** Where the support team should reply, if not the account email. Never auto-emailed. */
  email: z.string().trim().pipe(z.email().max(320)).optional()
});
export type SupportBody = z.infer<typeof SupportBodySchema>;

export const FeedbackBodySchema = z.object({
  sentiment: z.enum(["up", "down"]),
  reasons: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
  note: z.string().trim().max(2000).optional(),
  path: z.string().trim().max(300).optional()
});
export type FeedbackBody = z.infer<typeof FeedbackBodySchema>;

export type SupportTicket = {
  id: string;
  category: SupportCategory;
  message: string;
  contact_email: string | null;
  created_at: string;
};

export async function createSupportTicket(
  sb: SupabaseClient,
  args: {
    userId: string;
    merchantId: string | null;
    category: SupportCategory;
    message: string;
    contactEmail: string | null;
  }
): Promise<SupportTicket> {
  const { data, error } = await sb
    .from("support_tickets")
    .insert({
      user_id: args.userId,
      merchant_id: args.merchantId,
      category: args.category,
      message: args.message,
      contact_email: args.contactEmail,
      status: "open"
    })
    .select("id, category, message, contact_email, created_at")
    .single();
  assertNoDbError(error, "Save support request", { route: "POST /api/support", code: "support_ticket_failed" });
  if (!data) throw new HttpError(500, "Save support request failed", "support_ticket_failed");
  return data as SupportTicket;
}

export async function markTicketForwarded(sb: SupabaseClient, ticketId: string): Promise<void> {
  const { error } = await sb
    .from("support_tickets")
    .update({ forwarded_at: new Date().toISOString() })
    .eq("id", ticketId);
  if (error) throw new Error(`mark support ticket forwarded: ${error.message}`);
}

export async function recordFeedback(
  sb: SupabaseClient,
  args: { userId: string; merchantId: string | null } & FeedbackBody
): Promise<void> {
  const { error } = await sb.from("user_feedback").insert({
    user_id: args.userId,
    merchant_id: args.merchantId,
    sentiment: args.sentiment,
    reasons: args.reasons,
    note: args.note || null,
    path: args.path || null
  });
  assertNoDbError(error, "Save feedback", { route: "POST /api/feedback", code: "feedback_failed" });
}
