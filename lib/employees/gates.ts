/**
 * Who may run, and who may be switched on (F10, SW-18).
 *
 * An employee does work (dashboard chat, inbound replies, the 24/7 tick) only when
 *   1. its merchant's plan includes AI employees and the subscription is in good standing
 *      (merchantCanUseFeature — the same rule the hire route applies), and
 *   2. its own seat is paid: a running trial, or a paid period that has not ended, and
 *   3. it is `active`.
 * Switching an employee to `active` additionally requires the plan's seat limit to hold.
 *
 * Pure: callers load the rows (service role in the runtime/cron, the owner's session in
 * routes) and pass `now`.
 */
import { employeeLimitForPlan, featureGateMessage, merchantCanUseFeature } from "@/lib/billing/entitlements";
import type { Merchant } from "@/lib/types/database";
import { EmployeeApiError } from "./http";
import type { AIEmployeeRow } from "./types";

/**
 * The merchant fields the gates read — whatever merchantCanUseFeature takes (it may grow,
 * e.g. subscription expiry), so a caller that loads too few columns fails typecheck.
 */
export type GateMerchant = Parameters<typeof merchantCanUseFeature>[0] & Pick<Merchant, "plan">;

/** Columns to select from `merchants` (service role) for the gates and the DPA check. */
export const GATE_MERCHANT_COLUMNS = "id, owner_user_id, plan, subscription_status, subscription_expires_at, dpa_version";

export type SeatUnpaidReason = "trial_ended" | "past_due" | "canceled" | "no_billing_period";

export type SeatStanding = { paid: true; until: string } | { paid: false; reason: SeatUnpaidReason };

type SeatFields = Pick<AIEmployeeRow, "billing_status" | "trial_ends_at" | "next_billing_at">;

function future(iso: string | null | undefined, now: Date): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t > now.getTime();
}

/** A running trial, or a paid period that has not ended. Anything else is unpaid (fail closed). */
export function employeeSeatStanding(emp: SeatFields, now = new Date()): SeatStanding {
  switch (emp.billing_status) {
    case "trial":
      return future(emp.trial_ends_at, now)
        ? { paid: true, until: emp.trial_ends_at as string }
        : { paid: false, reason: emp.trial_ends_at ? "trial_ended" : "no_billing_period" };
    case "active":
      return future(emp.next_billing_at, now)
        ? { paid: true, until: emp.next_billing_at as string }
        : { paid: false, reason: emp.next_billing_at ? "past_due" : "no_billing_period" };
    case "past_due":
      return { paid: false, reason: "past_due" };
    case "canceled":
      return { paid: false, reason: "canceled" };
    default:
      return { paid: false, reason: "no_billing_period" };
  }
}

export type EmployeeGateReason = "plan_required" | "seat_unpaid" | "employee_inactive";

export type EmployeeRunGate =
  | { ok: true }
  | { ok: false; reason: EmployeeGateReason; seat?: SeatUnpaidReason };

/** May this employee do work right now? */
export function employeeRunGate(
  emp: SeatFields & Pick<AIEmployeeRow, "status">,
  merchant: GateMerchant | null | undefined,
  now = new Date()
): EmployeeRunGate {
  if (!merchant || !merchantCanUseFeature(merchant, "employees")) return { ok: false, reason: "plan_required" };
  const seat = employeeSeatStanding(emp, now);
  if (!seat.paid) return { ok: false, reason: "seat_unpaid", seat: seat.reason };
  if (emp.status !== "active") return { ok: false, reason: "employee_inactive" };
  return { ok: true };
}

/** The API refusal for a failed run gate (chat): 402 for billing, 409 for a paused employee. */
export function runGateError(gate: Exclude<EmployeeRunGate, { ok: true }>, emp: SeatFields): EmployeeApiError {
  switch (gate.reason) {
    case "plan_required":
      return new EmployeeApiError(402, "plan_required", featureGateMessage("employees"));
    case "seat_unpaid":
      return new EmployeeApiError(
        402,
        "seat_unpaid",
        "This employee's trial has ended or its seat is unpaid. Pay for the seat to run it again.",
        { billing_status: emp.billing_status, seat: gate.seat }
      );
    case "employee_inactive":
      return new EmployeeApiError(409, "employee_inactive", "This employee is paused. Resume it first.");
  }
}

/** 402 seat_unpaid for a switch to `active`. */
export function seatUnpaidOnResumeError(emp: Pick<SeatFields, "billing_status">, reason: SeatUnpaidReason): EmployeeApiError {
  return new EmployeeApiError(
    402,
    "seat_unpaid",
    "This employee's trial has ended or its seat is unpaid. Pay for the seat before resuming it.",
    { billing_status: emp.billing_status, seat: reason }
  );
}

/** 402 seat_limit for a switch to `active`. */
export function seatLimitOnResumeError(merchant: Pick<GateMerchant, "plan">, limit: number): EmployeeApiError {
  return new EmployeeApiError(
    402,
    "seat_limit",
    `Your ${merchant.plan} plan includes up to ${limit} AI employees. Upgrade or offboard someone before resuming this one.`,
    { limit }
  );
}

/**
 * The parts of F10 that need no seat count: the plan must include employees and the seat must
 * be paid. The count is checked atomically by activate_ai_employee() (RE-3).
 */
export function assertCanResume(emp: SeatFields, merchant: GateMerchant, now = new Date()): void {
  if (!merchantCanUseFeature(merchant, "employees")) {
    throw new EmployeeApiError(402, "plan_required", featureGateMessage("employees"));
  }
  const seat = employeeSeatStanding(emp, now);
  if (!seat.paid) throw seatUnpaidOnResumeError(emp, seat.reason);
}

/**
 * Refuse a switch to `active` (F10): the plan must include employees, the seat must be paid,
 * and the merchant's non-offboarded employees (this one included) must fit the plan's limit.
 * `nonOffboardedCount` must come from a successful count query — callers fail closed. This is
 * the fast path; the switch itself goes through activate_ai_employee(), which re-checks the
 * seat and the count under the merchant lock (RE-3).
 */
export function assertCanActivate(
  emp: SeatFields,
  merchant: GateMerchant,
  nonOffboardedCount: number,
  now = new Date()
): void {
  assertCanResume(emp, merchant, now);
  const limit = employeeLimitForPlan(merchant.plan ?? "lite");
  if (nonOffboardedCount > limit) throw seatLimitOnResumeError(merchant, limit);
}
