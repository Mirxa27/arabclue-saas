import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi, getCurrentMerchant } from "@/lib/auth/session";
import { getServiceSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { requestComplianceCSID, requestProductionCSID } from "@/lib/zatca/fatoora";

const Schema = z.object({
  otp: z.string().min(4),
  csr: z.string().min(20)
});

export async function POST(req: NextRequest) {
  try {
    await requireUserApi();
    const merchant = await getCurrentMerchant();
    if (!merchant) return NextResponse.json({ error: "no merchant" }, { status: 400 });

    const { otp, csr } = Schema.parse(await req.json());
    const base = process.env.ZATCA_FATOORA_BASE!;

    const compliance = await requestComplianceCSID({ base, csr, otp });
    const complianceCSID = Buffer.from(`${compliance.binarySecurityToken}:${compliance.secret}`).toString("base64");

    const production = await requestProductionCSID({
      base,
      complianceCSID,
      complianceRequestID: compliance.requestID
    });
    const productionCSID = Buffer.from(`${production.binarySecurityToken}:${production.secret}`).toString("base64");

    // zatca_* columns are not writable through the Data API; scoped to the session's merchant.
    const { error } = await getServiceSupabase()
      .from("merchants")
      .update({ zatca_csid: productionCSID, zatca_onboarded_at: new Date().toISOString() })
      .eq("id", merchant.id);
    if (error) throw new Error(`Saving the ZATCA CSID failed: ${error.message}`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/zatca/onboard" });
  }
}
