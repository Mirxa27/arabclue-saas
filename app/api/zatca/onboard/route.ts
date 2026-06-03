import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi, getCurrentMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { requestComplianceCSID, requestProductionCSID } from "@/lib/zatca/fatoora";

const Schema = z.object({
  otp: z.string().min(4),
  csr: z.string().min(20)
});

export async function POST(req: NextRequest) {
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

  const supabase = await getServerSupabase();
  await supabase
    .from("merchants")
    .update({ zatca_csid: productionCSID, zatca_onboarded_at: new Date().toISOString() })
    .eq("id", merchant.id);

  return NextResponse.json({ ok: true });
}
