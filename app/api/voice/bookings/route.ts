import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { voiceRouteError, VoiceApiError } from "@/lib/voice/http";
import {
  BOOKING_STATUSES,
  BookingPatchSchema,
  listVoiceBookings,
  parseRequestsLimit,
  updateVoiceBookingStatus
} from "@/lib/voice/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const StatusQuery = z.enum(BOOKING_STATUSES).optional();

/**
 * GET   /api/voice/bookings?status=new&limit=N → { bookings } — booking requests the voice
 *       agent recorded (source 'voice'), newest first, N ≤ 100.
 * PATCH /api/voice/bookings { id, status: new|confirmed|done|canceled } → { ok, booking }.
 * Both run on the merchant's own session (RLS bookings_self); 404 for someone else's booking.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const merchant = await requireMerchantApi();
    const status = StatusQuery.parse(req.nextUrl.searchParams.get("status") ?? undefined);
    const limit = parseRequestsLimit(req.nextUrl.searchParams.get("limit"));
    const bookings = await listVoiceBookings(await getServerSupabase(), merchant.id, { status, limit });
    return NextResponse.json({ bookings });
  } catch (err) {
    return voiceRouteError(err, "GET /api/voice/bookings");
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const merchant = await requireMerchantApi();
    const limited = await enforceRateLimit(req, "voice:bookings", 60, 60_000, merchant.id);
    if (limited instanceof NextResponse) return limited;
    const { id, status } = BookingPatchSchema.parse(await req.json());
    const booking = await updateVoiceBookingStatus(await getServerSupabase(), merchant.id, id, status);
    if (!booking) throw new VoiceApiError(404, "not_found", "Booking not found");
    return NextResponse.json({ ok: true, booking });
  } catch (err) {
    return voiceRouteError(err, "PATCH /api/voice/bookings");
  }
}
