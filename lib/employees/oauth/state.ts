/**
 * Signed state for employee-scoped OAuth.
 *
 * Same HMAC pattern as lib/oauth/state.ts, but scoped to a single employee +
 * integration kind so we know exactly where to attach the resulting tokens.
 */

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { IntegrationKind } from "@/lib/employees/types";

export type EmployeeOAuthState = {
  employeeId: string;
  merchantId: string;
  kind: IntegrationKind;
  codeVerifier?: string;
  returnTo?: string;
  exp: number;
  nonce: string;
};

function secret(): string {
  const s = process.env.OAUTH_STATE_SECRET ?? process.env.CRON_SECRET;
  if (!s) throw new Error("OAUTH_STATE_SECRET or CRON_SECRET is required for OAuth");
  return s;
}

function sign(payloadB64: string): string {
  return createHmac("sha256", secret()).update(payloadB64).digest("base64url");
}

export function createEmployeeOAuthState(
  payload: Omit<EmployeeOAuthState, "exp" | "nonce"> & { ttlSec?: number }
): string {
  const { ttlSec, ...rest } = payload;
  const full: EmployeeOAuthState = {
    ...rest,
    nonce: randomBytes(12).toString("hex"),
    exp: Date.now() + (ttlSec ?? 600) * 1000
  };
  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyEmployeeOAuthState(state: string): EmployeeOAuthState {
  const [body, sig] = state.split(".");
  if (!body || !sig) throw new Error("Invalid OAuth state");
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("OAuth state signature mismatch");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as EmployeeOAuthState;
  if (payload.exp < Date.now()) throw new Error("OAuth state expired");
  if (!payload.employeeId || !payload.merchantId || !payload.kind) {
    throw new Error("OAuth state missing required fields");
  }
  return payload;
}
