/**
 * POST /api/feedback — store a thumbs-up/down from the dashboard feedback widget.
 * Signed-in users only, rate-limited; a failed insert is a 5xx (the widget then shows
 * its error state instead of thanking the user for feedback that was never stored).
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentMerchant, requireUserApi } from "@/lib/auth/session";
import { getServiceSupabase } from "@/lib/db/supabase";
import { formatZodIssues, handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { FeedbackBodySchema, recordFeedback } from "@/lib/support/tickets";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUserApi();
    const limited = await enforceRateLimit(req, "feedback:create", 20, 15 * 60_000, user.id);
    if (limited instanceof NextResponse) return limited;

    const parsed = FeedbackBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodIssues(parsed.error) }, { status: 400 });
    }
    const merchant = await getCurrentMerchant();

    await recordFeedback(getServiceSupabase(), {
      userId: user.id,
      merchantId: merchant?.id ?? null,
      ...parsed.data
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/feedback" });
  }
}
