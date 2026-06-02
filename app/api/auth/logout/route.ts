import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/db/supabase";

export async function POST() {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"), { status: 303 });
}
