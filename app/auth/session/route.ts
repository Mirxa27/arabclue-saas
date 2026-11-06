import type { NextRequest } from "next/server";
import { handleRouteError } from "@/lib/api/route-handler";
import { establishSessionFromTokens } from "@/lib/auth/session-rescue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "POST /auth/session";

/** Implicit-flow rescue: `{ access_token, refresh_token, next }` → cookie session. */
export async function POST(req: NextRequest) {
  try {
    return await establishSessionFromTokens(req, ROUTE);
  } catch (err) {
    return handleRouteError(err, { route: ROUTE });
  }
}
