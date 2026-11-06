import { NextResponse, type NextRequest } from "next/server";
import { chatWithEmployee, ChatSchema, conversationTranscript } from "@/lib/employees/chat";
import { employeeRouteError, isUuid } from "@/lib/employees/http";
import { requireOwnedEmployee } from "@/lib/employees/route-helpers";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

// POST /api/employees/:id/chat — dashboard chat with the employee
//   body { message, conversation_id? } → { conversation_id, reply, message_id, latency_ms }
//   402 plan_required | seat_unpaid, 409 employee_inactive, 404 conversation_not_found
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const limited = await enforceRateLimit(req, "employees:chat", 60, 60_000, id);
    if (limited instanceof NextResponse) return limited;

    const { merchant, employee } = await requireOwnedEmployee(id);
    const body = ChatSchema.parse(await req.json());
    return NextResponse.json(await chatWithEmployee(merchant, employee, body));
  } catch (err) {
    return employeeRouteError(err, "POST /api/employees/:id/chat");
  }
}

// GET /api/employees/:id/chat?conversation_id=... — fetch transcript (404 for another employee's conversation)
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { employee } = await requireOwnedEmployee((await ctx.params).id);
    const convoId = req.nextUrl.searchParams.get("conversation_id");
    if (!convoId) return NextResponse.json({ messages: [] });
    if (!isUuid(convoId)) {
      return NextResponse.json({ error: "conversation_id must be a uuid", code: "invalid_request" }, { status: 400 });
    }
    return NextResponse.json({ messages: await conversationTranscript(employee.id, convoId) });
  } catch (err) {
    return employeeRouteError(err, "GET /api/employees/:id/chat");
  }
}
