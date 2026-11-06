import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const insert = vi.hoisted(() => vi.fn(async () => ({ error: null })));
vi.mock("@/lib/db/supabase", () => ({ getServiceSupabase: () => ({ from: () => ({ insert }) }) }));

import { POST } from "@/app/api/analytics/track/route";

let ip = 0;
const post = (body: string, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest("http://localhost/api/analytics/track", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${++ip % 250}`, ...headers },
      body
    })
  );

beforeEach(() => insert.mockClear());

describe("POST /api/analytics/track (F32 bounds)", () => {
  it("stores a small flat event", async () => {
    const res = await post(JSON.stringify({ name: "page.view", props: { path: "/dashboard", n: 1, ok: true } }));
    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("rejects bodies over 4 KB before parsing", async () => {
    const res = await post(JSON.stringify({ name: "x", props: { a: "y".repeat(5000) } }));
    expect(res.status).toBe(413);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects nested objects, too many keys and long strings", async () => {
    expect((await post(JSON.stringify({ name: "x", props: { a: { deep: 1 } } }))).status).toBe(400);
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i]));
    expect((await post(JSON.stringify({ name: "x", props: many }))).status).toBe(400);
    expect((await post(JSON.stringify({ name: "x", props: { a: "z".repeat(201) } }))).status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    expect((await post("{nope")).status).toBe(400);
  });

  it("honours Do-Not-Track", async () => {
    const res = await post(JSON.stringify({ name: "x" }), { dnt: "1" });
    expect(await res.json()).toEqual({ ok: true, skipped: "dnt" });
    expect(insert).not.toHaveBeenCalled();
  });
});
