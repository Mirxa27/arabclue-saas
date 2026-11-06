import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/db/supabase";
import { reportError } from "@/lib/observability/error-reporter";

export async function POST(req: NextRequest) {
  const home = new URL("/", process.env.NEXT_PUBLIC_SITE_URL || req.url);
  try {
    const supabase = await getServerSupabase();
    await supabase.auth.signOut();
  } catch (err) {
    // Still send the user home; the session cookie expires on its own.
    reportError(err, { route: "POST /api/auth/logout" });
  }
  return NextResponse.redirect(home, { status: 303 });
}
