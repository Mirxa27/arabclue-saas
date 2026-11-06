/**
 * F12 / F28 — getSallaAccessToken / sallaApiForMerchant (lib/salla/tokens.ts).
 * Salla refresh tokens are single-use (docs.salla.dev/doc-421118): a refresh happens once per
 * merchant even under concurrency, the rotated pair is stored encrypted with a compare-and-swap,
 * and a re-authorization that lands mid-refresh is never overwritten.
 *
 * The merchants row and salla_claim_refresh_lease are simulated statefully (each query is atomic,
 * like a single SQL statement); supabase/tests/40_salla_connect.test.sql and
 * __tests__/integration/salla.int.test.ts cover the real database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { SALLA_HTTP_TIMEOUT_MS } from "@/lib/salla/oauth";

vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

import {
  getSallaAccessToken,
  sallaApiForMerchant,
  SallaConnectionError,
  SALLA_REFRESH_LEASE_SECONDS
} from "@/lib/salla/tokens";

const M = "aaaaaaaa-0000-4000-8000-00000000000a";
const DAY = 24 * 60 * 60 * 1000;

type Row = {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  salla_token_invalid_at: string | null;
  salla_refresh_lease: string | null;
  salla_refresh_lease_until: string | null;
};

function matches(row: Row, call: FakeCall): boolean {
  return call.filters.every(([op, col, val]) => op === "eq" && (row as Record<string, unknown>)[col] === val);
}

/** Stateful merchants row + lease RPC. `onSelect` lets a test change the row between statements. */
function tokenDb(initial: Partial<Row>) {
  const row: Row = {
    id: M,
    access_token: encryptSecret("old-access"),
    refresh_token: encryptSecret("old-refresh"),
    token_expires_at: new Date(Date.now() + 7 * DAY).toISOString(),
    salla_token_invalid_at: null,
    salla_refresh_lease: null,
    salla_refresh_lease_until: null,
    ...initial
  };
  const fake = createFakeSupabase(
    "service",
    (call) => {
      if (call.table !== "merchants") throw new Error(`unexpected table ${call.table}`);
      if (call.op === "select") return { data: matches(row, call) ? { ...row } : null };
      if (call.op === "update") {
        if (!matches(row, call)) return { data: [] };
        Object.assign(row, call.payload as Partial<Row>);
        return { data: [{ id: row.id }] };
      }
      throw new Error(`unexpected op ${call.op}`);
    },
    (fn, args) => {
      if (fn !== "salla_claim_refresh_lease") throw new Error(`unexpected rpc ${fn}`);
      const free = !row.salla_refresh_lease_until || Date.parse(row.salla_refresh_lease_until) < Date.now();
      if (args.p_merchant_id === row.id && row.refresh_token && !row.salla_token_invalid_at && free) {
        row.salla_refresh_lease = randomUUID();
        row.salla_refresh_lease_until = new Date(Date.now() + Number(args.p_lease_seconds) * 1000).toISOString();
        return { data: row.salla_refresh_lease };
      }
      return { data: null };
    }
  );
  return { row, fake, client: fake.client };
}

type TokenCall = { body: URLSearchParams };

/** Stub fetch: Salla's token endpoint (scripted) and the Merchant API (scripted per token). */
function stubSalla(opts: {
  refresh?: (n: number) => Response | Promise<Response>;
  api?: (token: string) => Response;
}) {
  const tokenCalls: TokenCall[] = [];
  const apiCalls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === "https://accounts.salla.sa/oauth2/token") {
        tokenCalls.push({ body: new URLSearchParams(String(init?.body)) });
        if (!opts.refresh) throw new Error("unexpected refresh");
        return opts.refresh(tokenCalls.length);
      }
      if (url.startsWith("https://api.salla.dev/admin/v2/")) {
        const token = String(new Headers(init?.headers).get("authorization")).replace(/^Bearer /, "");
        apiCalls.push(token);
        return opts.api ? opts.api(token) : new Response("{}", { status: 200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    })
  );
  return { tokenCalls, apiCalls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const rotated = (n: number) =>
  json(200, { access_token: `new-access-${n}`, refresh_token: `new-refresh-${n}`, expires_in: 1209599, token_type: "bearer" });

const fastSleep = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-token-encryption-key-32-chars-min");
  vi.stubEnv("SALLA_CLIENT_ID", "salla-id");
  vi.stubEnv("SALLA_CLIENT_SECRET", "salla-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getSallaAccessToken", () => {
  it("returns the stored (decrypted) token while it is valid, without refreshing", async () => {
    const db = tokenDb({});
    const salla = stubSalla({});
    expect(await getSallaAccessToken(M, { client: db.client })).toBe("old-access");
    expect(salla.tokenCalls).toHaveLength(0);
    expect(db.fake.rpcCalls).toHaveLength(0);
  });

  it("refreshes before token_expires_at and persists the rotated pair encrypted", async () => {
    const db = tokenDb({ token_expires_at: new Date(Date.now() + 60_000).toISOString() }); // inside the skew
    const salla = stubSalla({ refresh: rotated });

    const token = await getSallaAccessToken(M, { client: db.client });

    expect(token).toBe("new-access-1");
    expect(salla.tokenCalls).toHaveLength(1);
    const body = salla.tokenCalls[0].body;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-refresh");
    expect(body.get("client_id")).toBe("salla-id");
    expect(body.get("client_secret")).toBe("salla-secret");

    expect(db.row.access_token).toMatch(/^enc:v1:/);
    expect(db.row.refresh_token).toMatch(/^enc:v1:/);
    expect(decryptSecret(db.row.access_token)).toBe("new-access-1");
    expect(decryptSecret(db.row.refresh_token)).toBe("new-refresh-1");
    expect(Date.parse(db.row.token_expires_at!)).toBeGreaterThan(Date.now() + 13 * DAY);
    expect(db.row.salla_refresh_lease).toBeNull();
    expect(db.row.salla_refresh_lease_until).toBeNull();

    // the persist was a compare-and-swap on the lease and the old refresh token
    const persist = db.fake.calls.find((c) => c.op === "update" && (c.payload as Row).access_token);
    expect(persist?.filters.map(([, col]) => col).sort()).toEqual(["id", "refresh_token", "salla_refresh_lease"]);
  });

  it("refreshes a token that is already expired", async () => {
    const db = tokenDb({ token_expires_at: new Date(Date.now() - DAY).toISOString() });
    stubSalla({ refresh: rotated });
    expect(await getSallaAccessToken(M, { client: db.client })).toBe("new-access-1");
  });

  it("concurrent callers trigger exactly one refresh and all get the new token", async () => {
    const db = tokenDb({ token_expires_at: new Date(Date.now() - 1000).toISOString() });
    const salla = stubSalla({
      refresh: async (n) => {
        await new Promise((resolve) => setTimeout(resolve, 40)); // Salla is slow
        return rotated(n);
      }
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => getSallaAccessToken(M, { client: db.client, sleep: fastSleep }))
    );

    expect(salla.tokenCalls).toHaveLength(1); // the single-use refresh token was used once
    expect(new Set(results)).toEqual(new Set(["new-access-1"]));
    expect(decryptSecret(db.row.refresh_token)).toBe("new-refresh-1");
    expect(db.row.salla_refresh_lease).toBeNull();
  });

  it("never overwrites a re-authorization that lands while the refresh is in flight", async () => {
    const db = tokenDb({ token_expires_at: new Date(Date.now() - 1000).toISOString() });
    stubSalla({
      refresh: (n) => {
        // app.store.authorize (or a reconnect) stores a newer pair before our persist runs
        db.row.access_token = encryptSecret("reauth-access");
        db.row.refresh_token = encryptSecret("reauth-refresh");
        db.row.token_expires_at = new Date(Date.now() + 14 * DAY).toISOString();
        return rotated(n);
      }
    });

    const token = await getSallaAccessToken(M, { client: db.client });

    expect(token).toBe("reauth-access");
    expect(decryptSecret(db.row.refresh_token)).toBe("reauth-refresh"); // not lost
    expect(decryptSecret(db.row.access_token)).toBe("reauth-access");
  });

  it("a disconnect that lands mid-refresh wins: nothing is resurrected", async () => {
    const db = tokenDb({ token_expires_at: new Date(Date.now() - 1000).toISOString() });
    stubSalla({
      refresh: (n) => {
        Object.assign(db.row, { access_token: null, refresh_token: null, token_expires_at: null });
        return rotated(n);
      }
    });
    await expect(getSallaAccessToken(M, { client: db.client })).rejects.toMatchObject({ code: "salla_not_connected", status: 409 });
    expect(db.row.access_token).toBeNull();
  });

  it("invalid_grant marks the connection for reconnect, and later calls fail fast without Salla", async () => {
    const db = tokenDb({ token_expires_at: new Date(Date.now() - 1000).toISOString() });
    const salla = stubSalla({ refresh: () => json(400, { error: "invalid_grant", error_description: "token reused" }) });

    await expect(getSallaAccessToken(M, { client: db.client })).rejects.toMatchObject({
      code: "salla_reconnect_required",
      status: 409
    });
    expect(db.row.salla_token_invalid_at).not.toBeNull();
    expect(db.row.salla_refresh_lease).toBeNull();

    await expect(getSallaAccessToken(M, { client: db.client })).rejects.toMatchObject({ code: "salla_reconnect_required" });
    expect(salla.tokenCalls).toHaveLength(1);
  });

  it("a transient refresh failure keeps the stored pair and releases the lease", async () => {
    const db = tokenDb({ token_expires_at: new Date(Date.now() - 1000).toISOString() });
    stubSalla({ refresh: () => json(503, { error: "temporarily_unavailable" }) });
    await expect(getSallaAccessToken(M, { client: db.client })).rejects.toMatchObject({ code: "salla_refresh_failed", status: 502 });
    expect(decryptSecret(db.row.refresh_token)).toBe("old-refresh");
    expect(db.row.salla_token_invalid_at).toBeNull();
    expect(db.row.salla_refresh_lease).toBeNull();
  });

  it("is honest when there is nothing to use: not connected, no app credentials, refresh busy", async () => {
    stubSalla({});
    await expect(getSallaAccessToken(M, { client: tokenDb({ access_token: null }).client })).rejects.toMatchObject({
      code: "salla_not_connected"
    });

    vi.stubEnv("SALLA_CLIENT_SECRET", "");
    const expired = tokenDb({ token_expires_at: new Date(Date.now() - 1000).toISOString() });
    await expect(getSallaAccessToken(M, { client: expired.client })).rejects.toMatchObject({
      code: "salla_not_configured",
      status: 503
    });
    vi.stubEnv("SALLA_CLIENT_SECRET", "salla-secret");

    // another worker holds the lease and never finishes
    const busy = tokenDb({
      token_expires_at: new Date(Date.now() - 1000).toISOString(),
      salla_refresh_lease: randomUUID(),
      salla_refresh_lease_until: new Date(Date.now() + 60_000).toISOString()
    });
    await expect(
      getSallaAccessToken(M, { client: busy.client, sleep: fastSleep, waitTimeoutMs: 50 })
    ).rejects.toMatchObject({ code: "salla_refresh_busy", status: 503 });
  });

  it("without a refresh token keeps using a still-valid token, then asks for a reconnect", async () => {
    stubSalla({});
    const soon = tokenDb({ refresh_token: null, token_expires_at: new Date(Date.now() + 60_000).toISOString() });
    expect(await getSallaAccessToken(M, { client: soon.client })).toBe("old-access");
    const expired = tokenDb({ refresh_token: null, token_expires_at: new Date(Date.now() - 1000).toISOString() });
    await expect(getSallaAccessToken(M, { client: expired.client })).rejects.toMatchObject({ code: "salla_reconnect_required" });
  });

  it("errors are typed SallaConnectionErrors that handleRouteError can map", async () => {
    stubSalla({});
    const err = await getSallaAccessToken(M, { client: tokenDb({ access_token: null }).client }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SallaConnectionError);
  });

  it("keeps the lease longer than any single Salla call can take", () => {
    expect(SALLA_REFRESH_LEASE_SECONDS * 1000).toBeGreaterThan(2 * SALLA_HTTP_TIMEOUT_MS);
  });
});

describe("sallaApiForMerchant", () => {
  it("refreshes once after a 401 and retries with the new token", async () => {
    const db = tokenDb({});
    const salla = stubSalla({
      refresh: rotated,
      api: (token) => (token === "old-access" ? json(401, { error: "Unauthenticated" }) : json(200, { data: [{ id: 1 }] }))
    });

    const res = await sallaApiForMerchant<{ data: unknown[] }>(M, "/orders?reference_id=1", undefined, { client: db.client });

    expect(res.data).toHaveLength(1);
    expect(salla.apiCalls).toEqual(["old-access", "new-access-1"]);
    expect(salla.tokenCalls).toHaveLength(1);
    expect(decryptSecret(db.row.refresh_token)).toBe("new-refresh-1");
  });

  it("after a 401, uses a token another worker already rotated instead of refreshing again", async () => {
    const db = tokenDb({});
    const salla = stubSalla({
      api: (token) => {
        if (token === "old-access") {
          // another worker refreshed meanwhile (Salla revoked our access token)
          db.row.access_token = encryptSecret("rotated-elsewhere");
          db.row.refresh_token = encryptSecret("refresh-elsewhere");
          return json(401, {});
        }
        return json(200, { ok: true });
      }
    });

    await sallaApiForMerchant(M, "/store/info", undefined, { client: db.client });
    expect(salla.apiCalls).toEqual(["old-access", "rotated-elsewhere"]);
    expect(salla.tokenCalls).toHaveLength(0); // the (rotated) refresh token was not presented twice
  });

  it("a second 401 with a fresh token asks for a reconnect; other errors pass through", async () => {
    const db = tokenDb({});
    stubSalla({ refresh: rotated, api: () => json(401, {}) });
    await expect(sallaApiForMerchant(M, "/products", undefined, { client: db.client })).rejects.toMatchObject({
      code: "salla_reconnect_required"
    });

    const db2 = tokenDb({});
    stubSalla({ api: () => json(500, {}) });
    await expect(sallaApiForMerchant(M, "/products?page=1", undefined, { client: db2.client })).rejects.toMatchObject({
      name: "SallaApiError",
      status: 500,
      message: "Salla /products → 500"
    });
  });
});
