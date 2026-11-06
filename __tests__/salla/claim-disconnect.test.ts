/**
 * F12 — linking an Easy Mode install only through an authenticated claim (the session's confirmed
 * email, never a client-supplied identity), and Disconnect dropping tokens + the store link.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeResult } from "../helpers/fake-supabase";

const session = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string | null; email_confirmed_at?: string | null },
  merchant: null as null | { id: string }
}));
const rpc = vi.hoisted(() => ({ result: (() => ({ data: { outcome: "linked" } })) as () => FakeResult }));
let service = createFakeSupabase("service");

vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    getSessionContext: vi.fn(async () => ({ user: session.user, merchant: session.merchant })),
    requireMerchantApi: vi.fn(async () => {
      if (!session.user) throw new actual.AuthError();
      if (!session.merchant) throw new Error("no merchant");
      return session.merchant;
    })
  };
});
vi.mock("@/lib/db/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/supabase")>()),
  getServiceSupabase: () => service.client
}));

import { POST as claim } from "@/app/api/salla/installs/claim/route";
import { POST as disconnect } from "@/app/api/merchant/disconnect-salla/route";

const M = "aaaaaaaa-0000-4000-8000-00000000000a";
let ip = 0;
const claimRequest = (body: unknown) =>
  new NextRequest("http://localhost:3111/api/salla/installs/claim", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${(ip = (ip % 250) + 1)}` },
    body: JSON.stringify(body)
  });

beforeEach(() => {
  session.user = { id: `user-${Math.random()}`, email: "Owner@Example.com", email_confirmed_at: "2026-11-01T00:00:00Z" };
  session.merchant = { id: M };
  rpc.result = () => ({ data: { outcome: "linked", merchant_id: M } });
  service = createFakeSupabase("service", () => ({ data: [{ id: M }] }), () => rpc.result());
});

describe("POST /api/salla/installs/claim", () => {
  it("links with the session's confirmed email — a body-supplied email is ignored", async () => {
    const res = await claim(claimRequest({ store_id: "9001", owner_email: "attacker@evil.example" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, store_id: "9001" });
    expect(service.rpcCalls).toEqual([
      { fn: "salla_claim_install", args: { p_merchant_id: M, p_salla_merchant_id: "9001", p_owner_email: "Owner@Example.com" } }
    ]);
  });

  it("maps outcomes to stable codes", async () => {
    rpc.result = () => ({ data: { outcome: "not_found" } });
    let res = await claim(claimRequest({ store_id: "9001" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "install_not_found" });

    rpc.result = () => ({ data: { outcome: "store_already_linked" } });
    res = await claim(claimRequest({ store_id: "9001" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "store_already_linked" });

    rpc.result = () => ({ error: { code: "57014", message: "timeout" } });
    expect((await claim(claimRequest({ store_id: "9001" }))).status).toBe(500);
  });

  it("requires a session, a merchant and a confirmed email; validates the store id", async () => {
    session.user = null;
    expect((await claim(claimRequest({ store_id: "9001" }))).status).toBe(401);

    session.user = { id: "u2", email: "owner@example.com", email_confirmed_at: "2026-11-01T00:00:00Z" };
    session.merchant = null;
    expect((await claim(claimRequest({ store_id: "9001" }))).status).toBe(403);

    session.merchant = { id: M };
    session.user = { id: "u3", email: "owner@example.com", email_confirmed_at: null };
    const unconfirmed = await claim(claimRequest({ store_id: "9001" }));
    expect(unconfirmed.status).toBe(403);
    expect(await unconfirmed.json()).toMatchObject({ code: "email_not_confirmed" });

    session.user = { id: "u4", email: "owner@example.com", email_confirmed_at: "2026-11-01T00:00:00Z" };
    const bad = await claim(claimRequest({ store_id: "9001; drop table" }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "invalid_request" });
    expect(service.rpcCalls).toHaveLength(0);
  });
});

describe("POST /api/merchant/disconnect-salla", () => {
  it("drops the tokens, the token-layer state and the store link on the caller's row only", async () => {
    const res = await disconnect();
    expect(res.status).toBe(200);
    const [update] = service.calls.filter((c) => c.op === "update");
    expect(update.table).toBe("merchants");
    expect(update.payload).toMatchObject({
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
      salla_merchant_id: null,
      salla_state: null,
      salla_store_name: null,
      salla_refresh_lease: null,
      salla_refresh_lease_until: null,
      salla_token_invalid_at: null
    });
    expect(update.filters).toEqual([["eq", "id", M]]);
  });

  it("fails with a stable 500 when the write fails", async () => {
    service = createFakeSupabase("service", () => ({ error: { code: "57014", message: "timeout" } }));
    const res = await disconnect();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Disconnect Salla failed" });
  });
});
