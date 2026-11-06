/**
 * arabclue — Agent Status API (GET + PATCH)
 *
 * GET   /api/agents/status → every persona agent (social, voice, seo, sales, support,
 *                            analyst) with its persona and stored state; defaults for
 *                            agents the merchant never touched
 * PATCH /api/agents/status → toggle / configure one agent; switching an agent on
 *                            requires a paid plan that includes its module (402)
 *
 * State lives in public.agent_settings (one row per merchant + persona). Hired
 * marketplace employees are served by /api/employees, not here.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { AgentPatchSchema } from "@/lib/agents/settings";
import { applyAgentPatch, listAgentEntries } from "@/lib/agents/store-server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const merchant = await requireMerchantApi();
    const agents = await listAgentEntries(await getServerSupabase(), merchant.id);
    return NextResponse.json({ agents });
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/agents/status" });
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const merchant = await requireMerchantApi();
    const limited = await enforceRateLimit(req, "agents:status", 30, 60_000, merchant.id);
    if (limited instanceof NextResponse) return limited;

    const patch = AgentPatchSchema.parse(await req.json());
    const agent = await applyAgentPatch(merchant, patch);
    return NextResponse.json({ ok: true, agent });
  } catch (err) {
    return handleRouteError(err, { route: "PATCH /api/agents/status" });
  }
}
