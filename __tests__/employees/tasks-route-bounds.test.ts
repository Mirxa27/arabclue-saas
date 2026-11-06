/**
 * RE-1 / RE-6 on the tasks API: title and description are accepted exactly up to the
 * ai_employee_tasks bounds (200 / 2000), NUL (which PostgreSQL text cannot hold) is refused,
 * and a database refusal is a 400 with a stable code — never the raw constraint text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, jsonRequest, type FakeSupabase } from "../helpers/fake-supabase";
import type { Merchant } from "@/lib/types/database";

const h = vi.hoisted(() => ({
  user: null as unknown as FakeSupabase,
  taskError: null as null | { code: string; message: string; details?: string }
}));

vi.mock("@/lib/db/supabase", () => ({
  getServerSupabase: async () => h.user.client,
  getServiceSupabase: () => {
    throw new Error("the tasks API writes through the owner's session");
  }
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireMerchantApi: vi.fn(async () => ({ id: "m1", plan: "plus", subscription_status: "active" }) as unknown as Merchant)
}));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn(), redactSensitive: (s: string) => s }));

import { PATCH, POST } from "@/app/api/employees/[id]/tasks/route";

const EMP = "66666666-6666-4666-8666-666666666601";
const TASK = "66666666-6666-4666-8666-666666666602";
const ctx = { params: Promise.resolve({ id: EMP }) };
const post = (body: Record<string, unknown>) => POST(jsonRequest(`http://localhost/api/employees/${EMP}/tasks`, body), ctx);
const patch = (body: Record<string, unknown>) =>
  PATCH(jsonRequest(`http://localhost/api/employees/${EMP}/tasks`, body, { method: "PATCH" }), ctx);

beforeEach(() => {
  h.taskError = null;
  h.user = createFakeSupabase("user", (call) => {
    if (call.table === "ai_employees") return { data: { id: EMP, merchant_id: "m1", role_id: "sales-rep", status: "active" } };
    if (call.table === "ai_employee_tasks" && call.op !== "select") {
      return h.taskError ? { error: h.taskError } : { data: { id: TASK, ...(call.payload as object) } };
    }
    return undefined;
  });
});

describe("tasks API bounds", () => {
  it("accepts a title and description exactly at the database bounds", async () => {
    const res = await post({ title: "t".repeat(200), description: "d".repeat(2000) });
    expect(res.status).toBe(200);
    const [insert] = h.user.writes();
    expect(insert.payload).toMatchObject({ title: "t".repeat(200), description: "d".repeat(2000), source: "user" });
  });

  it("refuses longer text and NUL characters before any write", async () => {
    for (const body of [{ title: "t".repeat(201) }, { title: "ok title", description: "d".repeat(2001) }, { title: "ok title", description: "a\u0000b" }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect((await patch({ id: TASK, title: "x\u0000y" })).status).toBe(400);
    expect(h.user.writes()).toHaveLength(0);
  });

  it("a database refusal is 400 invalid_request without the constraint text; other failures a stable 500", async () => {
    h.taskError = {
      code: "23514",
      message: 'new row for relation "ai_employee_tasks" violates check constraint "ai_employee_tasks_title_size"',
      details: "Failing row contains (secret …)"
    };
    let res = await post({ title: "Prepare the weekly report" });
    expect(res.status).toBe(400);
    let body = JSON.stringify(await res.json());
    expect(body).toContain("invalid_request");
    expect(body).not.toMatch(/violates|constraint|Failing row|secret/);

    h.taskError = { code: "XX000", message: "internal error on relation ai_employee_tasks" };
    res = await patch({ id: TASK, status: "done" });
    expect(res.status).toBe(500);
    body = JSON.stringify(await res.json());
    expect(body).not.toMatch(/internal error|relation/);
  });
});
