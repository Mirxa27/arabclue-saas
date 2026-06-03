import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireMerchant } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { handleRouteError } from "@/lib/api/route-handler";
import { respond, upsertConversation } from "@/lib/employees/runtime";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const ChatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversation_id: z.string().uuid().optional()
});

async function assertEmployeeOwned(id: string): Promise<string> {
  const merchant = await requireMerchant();
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("ai_employees")
    .select("id")
    .eq("id", id)
    .eq("merchant_id", merchant.id)
    .single();
  if (error || !data) throw new Error("Employee not found");
  return data.id as string;
}

// POST /api/employees/:id/chat — dashboard chat with the employee
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const limited = await enforceRateLimit(req, "employees:chat", 60, 60_000, (await ctx.params).id);
    if (limited instanceof NextResponse) return limited;

    const employeeId = await assertEmployeeOwned((await ctx.params).id);
    const body = ChatSchema.parse(await req.json());

    const conversationId =
      body.conversation_id ??
      (await upsertConversation({
        employeeId,
        channel: "dashboard",
        externalId: `dashboard:${employeeId}`
      })).id;

    const result = await respond({
      employeeId,
      conversationId,
      userMessage: body.message
    });

    return NextResponse.json({
      conversation_id: conversationId,
      reply: result.reply,
      message_id: result.messageId,
      latency_ms: result.latencyMs
    });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/employees/:id/chat" });
  }
}

// GET /api/employees/:id/chat?conversation_id=... — fetch transcript
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    await assertEmployeeOwned((await ctx.params).id);
    const url = new URL(req.url);
    const convoId = url.searchParams.get("conversation_id");
    if (!convoId) return NextResponse.json({ messages: [] });
    const sb = await getServerSupabase();
    const { data } = await sb
      .from("ai_employee_messages")
      .select("*")
      .eq("conversation_id", convoId)
      .order("created_at", { ascending: true });
    return NextResponse.json({ messages: data ?? [] });
  } catch (err) {
    return handleRouteError(err, { route: "GET /api/employees/:id/chat" });
  }
}
