import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { reportError } from "@/lib/observability/error-reporter";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { handleRouteError } from "@/lib/api/route-handler";

export const runtime = "nodejs";

const BodySchema = z.object({
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  url: z.string().max(500).optional(),
  component: z.string().max(200).optional()
});

export async function POST(req: NextRequest) {
  try {
    const limited = await enforceRateLimit(req, "client-error", 30, 60_000);
    if (limited instanceof NextResponse) return limited;

    const body = BodySchema.parse(await req.json());
    const err = new Error(body.message);
    if (body.stack) err.stack = body.stack;

    reportError(err, {
      route: "client",
      extra: {
        url: body.url,
        component: body.component,
        userAgent: req.headers.get("user-agent")?.slice(0, 200)
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, { route: "/api/observability/client-error" });
  }
}
