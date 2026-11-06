import type { NextRequest } from "next/server";
import { handleRouteError } from "@/lib/api/route-handler";
import { requestEmailOtp } from "@/lib/auth/otp";

export const runtime = "nodejs";

const ROUTE = "POST /api/auth/otp";

export async function POST(req: NextRequest) {
  try {
    return await requestEmailOtp(req, ROUTE);
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
