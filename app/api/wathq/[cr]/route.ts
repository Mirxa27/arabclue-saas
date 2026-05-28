import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { enrichCR } from "@/lib/wathq/client";

export async function GET(_req: NextRequest, { params }: { params: { cr: string } }) {
  await requireUser();
  const apiKey = process.env.WATHQ_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "wathq not configured" }, { status: 500 });
  if (!/^\d{10}$/.test(params.cr)) return NextResponse.json({ error: "invalid CR number" }, { status: 400 });

  try {
    const data = await enrichCR(params.cr, apiKey);
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "lookup failed" }, { status: 500 });
  }
}
