/**
 * GET /api/employees/:id/conversations?channel=&status=&limit=&cursor=
 *   → { conversations: ConversationSummary[], next_cursor: string | null }
 * The employee's channel conversations, newest activity first (the dashboard thread is
 * excluded unless channel=dashboard). Read-only; see lib/employees/conversations.ts.
 */
import { NextResponse, type NextRequest } from "next/server";
import { ConversationListQuerySchema, listConversations } from "@/lib/employees/conversations";
import { employeeRouteError } from "@/lib/employees/http";
import { requireOwnedEmployee } from "@/lib/employees/route-helpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { employee } = await requireOwnedEmployee((await ctx.params).id);
    const sp = req.nextUrl.searchParams;
    const q = ConversationListQuerySchema.parse({
      channel: sp.get("channel") ?? undefined,
      status: sp.get("status") ?? undefined,
      limit: sp.get("limit") ?? undefined,
      cursor: sp.get("cursor") ?? undefined
    });
    return NextResponse.json(await listConversations(employee.id, q));
  } catch (err) {
    return employeeRouteError(err, "GET /api/employees/:id/conversations");
  }
}
