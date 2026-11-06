/**
 * POST /api/support — store a support request, acknowledge it, relay it to the inbox.
 *
 * Signed-in users only, rate-limited (5 per 15 minutes per user). The ticket is
 * stored first — if that fails the caller gets a 5xx, never a success for a request
 * nobody can see. The acknowledgement goes only to the account's own email address;
 * an `email` in the body is stored as the reply-to contact, never mailed automatically.
 * Relay to SUPPORT_INBOX_EMAIL is best-effort and reported (response + error log).
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentMerchant, requireUserApi } from "@/lib/auth/session";
import { getServiceSupabase } from "@/lib/db/supabase";
import { formatZodIssues, handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { reportError } from "@/lib/observability/error-reporter";
import { createSupportTicket, markTicketForwarded, SupportBodySchema } from "@/lib/support/tickets";
import { forwardSupportTicket, isSupportEmailConfigured, sendSupportAck } from "@/lib/support/notify";

const ROUTE = "POST /api/support";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUserApi();
    const limited = await enforceRateLimit(req, "support:create", 5, 15 * 60_000, { identity: user.id });
    if (limited instanceof NextResponse) return limited;

    const parsed = SupportBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodIssues(parsed.error) }, { status: 400 });
    }
    const { category, message, email } = parsed.data;
    const merchant = await getCurrentMerchant();
    const accountEmail = user.email ?? null;

    const sb = getServiceSupabase();
    const ticket = await createSupportTicket(sb, {
      userId: user.id,
      merchantId: merchant?.id ?? null,
      category,
      message,
      contactEmail: email ?? accountEmail
    });

    let acknowledged = false;
    if (accountEmail && isSupportEmailConfigured()) {
      try {
        await sendSupportAck({ to: accountEmail, category });
        acknowledged = true;
      } catch (err) {
        reportError(err, { route: ROUTE, userId: user.id, extra: { step: "ack", ticketId: ticket.id } });
      }
    }

    let forwarded = false;
    try {
      const relay = await forwardSupportTicket({
        id: ticket.id,
        category,
        message,
        accountEmail,
        contactEmail: ticket.contact_email,
        merchantId: merchant?.id ?? null,
        merchantName: merchant?.seller_name ?? null,
        createdAt: ticket.created_at
      });
      if (relay.status === "sent") {
        forwarded = true;
        await markTicketForwarded(sb, ticket.id);
      }
    } catch (err) {
      reportError(err, { route: ROUTE, userId: user.id, extra: { step: "forward", ticketId: ticket.id } });
    }

    return NextResponse.json({ success: true, ticketId: ticket.id, acknowledged, forwarded }, { status: 201 });
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
