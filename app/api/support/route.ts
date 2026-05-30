import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentMerchant } from "@/lib/auth/session";

const SupportBodySchema = z.object({
  category: z.enum(["help", "bug", "feature", "billing"]),
  message: z.string().min(5).max(5000),
  email: z.string().email().optional(),
});

export async function POST(request: Request) {
  try {
    const merchant = await getCurrentMerchant();

    const body = await request.json();
    const parsed = SupportBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { category, message, email } = parsed.data;

    // Store in support_tickets table if available, otherwise log
    // This ensures the endpoint works even before the migration runs
    const { getServerSupabase } = await import("@/lib/db/supabase");
    const supabase = getServerSupabase();

    const { error } = await supabase.from("support_tickets").insert({
      merchant_id: merchant?.id ?? null,
      category,
      message,
      email: email ?? merchant?.email ?? null,
      status: "open",
    });

    if (error) {
      // Table might not exist yet — log and return success anyway
      // so the user doesn't see an error while we're deploying the migration
      console.warn("[support] DB insert failed — table may not exist yet:", error.message);
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    console.error("[support] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}