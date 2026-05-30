import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { handleRouteError, jsonError } from "@/lib/api/route-handler";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const BodySchema = z.object({
  email: z.string().email(),
  mode: z.enum(["login", "signup"]).default("login"),
  name: z.string().min(1).max(120).optional(),
  redirectTo: z.string().url().optional()
});

export async function POST(req: NextRequest) {
  try {
    const body = BodySchema.parse(await req.json());
    const limited = await enforceRateLimit(req, `auth:otp:${body.mode}`, 5, 15 * 60_000, body.email.toLowerCase());
    if (limited instanceof NextResponse) return limited;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return jsonError("Auth not configured", 503);

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? req.nextUrl.origin;
    const defaultRedirect =
      body.mode === "signup" ? `${siteUrl}/welcome` : `${siteUrl}/dashboard`;

    const supabase = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { error } = await supabase.auth.signInWithOtp({
      email: body.email,
      options: {
        data: body.name ? { full_name: body.name } : undefined,
        emailRedirectTo: body.redirectTo ?? defaultRedirect
      }
    });

    if (error) return jsonError(error.message, 400);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
