import { NextResponse } from "next/server";
import { EMPLOYEE_CATALOG, CATEGORIES } from "@/lib/employees/catalog";

export const dynamic = "force-static";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    roles: EMPLOYEE_CATALOG,
    categories: CATEGORIES
  });
}
