/**
 * GET   /api/employees/:id/conversations/:conversationId?limit=&before=
 *   → { conversation, messages (oldest first), next_before: string | null }
 * PATCH /api/employees/:id/conversations/:conversationId   body { status: "open" | "escalated" | "snoozed" | "closed" }
 *   → { conversation } — `escalated` / `snoozed` / `closed` hand the thread to a human (the AI
 *   stops replying there); `open` hands it back. 404 conversation_not_found, 400 for the
 *   dashboard thread. See lib/employees/conversations.ts.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  ConversationStatusSchema,
  getConversationHistory,
  MessagePageQuerySchema,
  setConversationStatus
} from "@/lib/employees/conversations";
import { employeeRouteError } from "@/lib/employees/http";
import { requireOwnedEmployee } from "@/lib/employees/route-helpers";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; conversationId: string }> };

export async function GET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  try {
    const { id, conversationId } = await ctx.params;
    const { employee } = await requireOwnedEmployee(id);
    const sp = req.nextUrl.searchParams;
    const q = MessagePageQuerySchema.parse({ limit: sp.get("limit") ?? undefined, before: sp.get("before") ?? undefined });
    return NextResponse.json(await getConversationHistory(employee.id, conversationId, q));
  } catch (err) {
    return employeeRouteError(err, "GET /api/employees/:id/conversations/:conversationId");
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  try {
    const { id, conversationId } = await ctx.params;
    const { merchant, employee } = await requireOwnedEmployee(id);
    const limited = await enforceRateLimit(req, "employees:conversation-status", 60, 60_000, merchant.id);
    if (limited instanceof NextResponse) return limited;
    const body = ConversationStatusSchema.parse(await req.json());
    return NextResponse.json({ conversation: await setConversationStatus(employee.id, conversationId, body.status) });
  } catch (err) {
    return employeeRouteError(err, "PATCH /api/employees/:id/conversations/:conversationId");
  }
}
