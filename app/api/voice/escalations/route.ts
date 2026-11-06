import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase, getServiceSupabase } from "@/lib/db/supabase";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { voiceRouteError, VoiceApiError } from "@/lib/voice/http";
import {
  ESCALATION_STATUSES,
  EscalationPatchSchema,
  listVoiceEscalations,
  parseRequestsLimit,
  updateVoiceEscalationStatus
} from "@/lib/voice/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const StatusQuery = z.enum(ESCALATION_STATUSES).optional();

/**
 * GET   /api/voice/escalations?status=open&limit=N → { escalations } — callers the store has to
 *       get back to (merchant session, RLS voice_escalations_select_own), newest first, N ≤ 100.
 * PATCH /api/voice/escalations { id, status: open|resolved } → { ok, escalation } — service role
 *       scoped to the session's merchant (merchants cannot write the table directly); 404 otherwise.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const merchant = await requireMerchantApi();
    const status = StatusQuery.parse(req.nextUrl.searchParams.get("status") ?? undefined);
    const limit = parseRequestsLimit(req.nextUrl.searchParams.get("limit"));
    const escalations = await listVoiceEscalations(await getServerSupabase(), merchant.id, { status, limit });
    return NextResponse.json({ escalations });
  } catch (err) {
    return voiceRouteError(err, "GET /api/voice/escalations");
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const merchant = await requireMerchantApi();
    const limited = await enforceRateLimit(req, "voice:escalations", 60, 60_000, merchant.id);
    if (limited instanceof NextResponse) return limited;
    const { id, status } = EscalationPatchSchema.parse(await req.json());
    const escalation = await updateVoiceEscalationStatus(getServiceSupabase(), merchant.id, id, status);
    if (!escalation) throw new VoiceApiError(404, "not_found", "Escalation not found");
    return NextResponse.json({ ok: true, escalation });
  } catch (err) {
    return voiceRouteError(err, "PATCH /api/voice/escalations");
  }
}
