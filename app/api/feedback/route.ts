import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentMerchant } from "@/lib/auth/session";

const FeedbackBodySchema = z.object({
  sentiment: z.enum(["up", "down"]),
  reasons: z.array(z.string()).max(10).default([]),
  note: z.string().max(2000).optional(),
  path: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const merchant = await getCurrentMerchant();

    const body = await request.json();
    const parsed = FeedbackBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { sentiment, reasons, note, path } = parsed.data;

    // Store in user_feedback table if available
    const { getServerSupabase } = await import("@/lib/db/supabase");
    const supabase = await getServerSupabase();

    const { error } = await supabase.from("user_feedback").insert({
      merchant_id: merchant?.id ?? null,
      sentiment,
      reasons,
      note: note ?? null,
      path: path ?? null,
    });

    if (error) {
      // Table might not exist yet
      console.warn("[feedback] DB insert failed — table may not exist yet:", error.message);
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    console.error("[feedback] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}