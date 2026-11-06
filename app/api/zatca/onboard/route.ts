/**
 * ZATCA EGS onboarding (F14 / UI-024 / SW-2).
 *
 *   GET   non-secret status: environment, step, compliance checks, certificate expiry, whether the
 *         merchant may use ZATCA right now (subscription, kill switch, configuration)
 *   POST  { otp?, restart?, branchName?, industry?, groupMemberTin? } — start (OTP from the FATOORA
 *         portal), resume a failed step (no OTP), or replace an active unit (restart + OTP).
 *         402 without an active subscription, 503 when disabled / not configured, 409 when the tax
 *         profile is incomplete. Afterwards the Salla orders that waited for onboarding are invoiced.
 * The EGS private key and CSIDs never leave the server (lib/zatca/egs-store.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServiceSupabase } from "@/lib/db/supabase";
import { formatZodIssues } from "@/lib/api/route-handler";
import { zatcaRouteError } from "@/lib/zatca/route-errors";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { reportError } from "@/lib/observability/error-reporter";
import { loadEgsRow, publicEgsStatus } from "@/lib/zatca/egs-store";
import { readZatcaConfig, requireZatcaAccess, zatcaAccess } from "@/lib/zatca/gates";
import { runOnboarding } from "@/lib/zatca/onboarding";
import { processPendingOrders } from "@/lib/invoices/pending-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ROUTE = "/api/zatca/onboard";

const BodySchema = z
  .object({
    otp: z.string().trim().max(20).optional(),
    restart: z.boolean().optional(),
    branchName: z.string().trim().max(64).optional(),
    industry: z.string().trim().max(100).optional(),
    groupMemberTin: z.string().trim().max(20).optional()
  })
  .strict();

export async function GET() {
  try {
    const merchant = await requireMerchantApi();
    const cfg = readZatcaConfig();
    const row = await loadEgsRow(getServiceSupabase(), merchant.id);
    const access = await zatcaAccess(merchant);
    return NextResponse.json({
      status: publicEgsStatus(row, cfg),
      access: access.ok ? { ok: true } : { ok: false, reason: access.reason, message: access.message }
    });
  } catch (err) {
    return zatcaRouteError(err, `GET ${ROUTE}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const merchant = await requireMerchantApi();
    const limited = await enforceRateLimit(req, "zatca:onboard", 6, 10 * 60_000, merchant.id);
    if (limited instanceof NextResponse) return limited;

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodIssues(parsed.error), code: "invalid_request" }, { status: 400 });
    }
    const cfg = await requireZatcaAccess(merchant);
    const sb = getServiceSupabase();
    const status = await runOnboarding(sb, merchant, cfg, parsed.data);

    let pending = null;
    if (status.onboarded) {
      try {
        pending = await processPendingOrders(sb, merchant, { limit: 25 });
      } catch (err) {
        reportError(err, { route: `POST ${ROUTE}`, merchantId: merchant.id, extra: { step: "pending salla orders" } });
      }
    }
    return NextResponse.json({ status, pending });
  } catch (err) {
    return zatcaRouteError(err, `POST ${ROUTE}`);
  }
}
