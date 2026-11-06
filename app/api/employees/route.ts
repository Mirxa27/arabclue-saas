import { NextResponse, type NextRequest } from "next/server";
import { requireMerchantApi } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/db/supabase";
import { hireEmployee, HireSchema } from "@/lib/employees/hire";
import { employeeRouteError } from "@/lib/employees/http";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

// ── GET /api/employees — list hired employees for the merchant ───────────────
export async function GET(): Promise<NextResponse> {
  try {
    const merchant = await requireMerchantApi();
    const sb = await getServerSupabase();
    const { data, error } = await sb
      .from("ai_employees")
      .select("*")
      .eq("merchant_id", merchant.id)
      .order("hired_at", { ascending: false });
    if (error) throw new Error(error.message);

    return NextResponse.json({ employees: data ?? [] });
  } catch (err) {
    return employeeRouteError(err, "GET /api/employees");
  }
}

// ── POST /api/employees — hire a new AI employee ─────────────────────────────
// 402 plan_required | seat_limit (+limit), 409 duplicate_employee, 400 validation.
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const merchant = await requireMerchantApi();
    const limited = await enforceRateLimit(req, "employees:hire", 10, 60_000, merchant.id);
    if (limited instanceof NextResponse) return limited;

    const body = HireSchema.parse(await req.json());
    return NextResponse.json(await hireEmployee(merchant, body));
  } catch (err) {
    return employeeRouteError(err, "POST /api/employees");
  }
}
