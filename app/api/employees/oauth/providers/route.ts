/**
 * Lists OAuth providers and whether they're configured in this deployment.
 *
 * The UI uses this to render the right Connect buttons. The endpoint reveals
 * only the *kind* and label — never the credentials.
 */
import { NextResponse } from "next/server";
import { listConfiguredOAuthProviders } from "@/lib/employees/oauth/providers";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ providers: listConfiguredOAuthProviders() });
}
