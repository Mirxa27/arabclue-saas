import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { MoyasarApiError } from "@/lib/moyasar/types";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function handleRouteError(err: unknown) {
  if (err instanceof ZodError) {
    return jsonError(err.errors.map((e) => e.message).join("; "), 400);
  }
  if (err instanceof MoyasarApiError) {
    console.error("[api]", err.message);
    return jsonError(err.message, err.status || 500);
  }
  if (err instanceof Error) {
    console.error("[api]", err.message);
    return jsonError(err.message, 500);
  }
  console.error("[api] unknown error", err);
  return jsonError("Internal server error", 500);
}
