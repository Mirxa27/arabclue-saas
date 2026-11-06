/**
 * SW-27: X / TikTok access tokens are refreshed before publishing; the single-use refresh
 * token is rotated under a per-channel lease and stored with a compare-and-swap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { ChannelTokenError, getChannelAccessToken, type ChannelRow } from "@/lib/social/token-refresh";
import { TokenRefreshError } from "@/lib/social/http";
import { refreshXToken, X_TOKEN_URL } from "@/lib/x/oauth";
import { exchangeTikTokCode, refreshTikTokToken, TIKTOK_TOKEN_URL } from "@/lib/tiktok/oauth";

vi.mock("@/lib/observability/error-reporter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/error-reporter")>()),
  reportError: vi.fn()
}));

const NOW = Date.parse("2026-11-06T12:00:00Z");

beforeEach(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-token-encryption-key-32-chars-min"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** One social_channels row with lease + compare-and-swap semantics. */
function channelDb(initial: Partial<ChannelRow> = {}) {
  const row: ChannelRow & { refresh_lease: string | null; refresh_lease_until: number } = {
    id: "ch-1",
    merchant_id: "m1",
    platform: "x",
    external_id: "x-user",
    access_token_encrypted: encryptSecret("old-access"),
    refresh_token_encrypted: encryptSecret("old-refresh"),
    token_expires_at: new Date(NOW - 60_000).toISOString(),
    token_invalid_at: null,
    refresh_lease: null,
    refresh_lease_until: 0,
    ...initial
  };
  const matches = (call: FakeCall) =>
    call.filters.every(([op, column, value]) => op !== "eq" || (row as Record<string, unknown>)[column] === value);
  const db = createFakeSupabase(
    "service",
    (call) => {
      if (call.table !== "social_channels") return undefined;
      if (call.op === "select") return { data: { ...row } };
      if (call.op === "update") {
        if (!matches(call)) return { data: [] };
        Object.assign(row, call.payload);
        return { data: [{ id: row.id }] };
      }
      return undefined;
    },
    (fn) => {
      if (fn !== "social_claim_token_refresh") return undefined;
      if (!row.refresh_token_encrypted || row.token_invalid_at || (row.refresh_lease && row.refresh_lease_until > Date.now())) {
        return { data: null };
      }
      row.refresh_lease = `lease-${Math.random()}`;
      row.refresh_lease_until = Date.now() + 60_000;
      return { data: row.refresh_lease };
    }
  );
  return { row, db, channel: () => ({ ...row }) as ChannelRow };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 1));

describe("getChannelAccessToken", () => {
  it("uses a token that is not near expiry as is", async () => {
    const { db, channel } = channelDb({ token_expires_at: new Date(NOW + 3600_000).toISOString() });
    const refresher = vi.fn();
    await expect(getChannelAccessToken(db.client, channel(), { now: () => NOW, refreshers: { x: refresher } })).resolves.toBe("old-access");
    expect(refresher).not.toHaveBeenCalled();
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("refreshes an expired token under the lease and stores the rotated pair with a compare-and-swap", async () => {
    const { db, row, channel } = channelDb();
    const refresher = vi.fn(async () => ({ accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 7200 }));
    await expect(getChannelAccessToken(db.client, channel(), { now: () => NOW, refreshers: { x: refresher } })).resolves.toBe("new-access");

    expect(refresher).toHaveBeenCalledWith("old-refresh");
    expect(decryptSecret(row.access_token_encrypted)).toBe("new-access");
    expect(decryptSecret(row.refresh_token_encrypted)).toBe("new-refresh");
    expect(row.token_expires_at).toBe(new Date(NOW + 7200_000).toISOString());
    expect(row.refresh_lease).toBeNull();
    const cas = db.writes().find((c) => c.op === "update" && (c.payload as Record<string, unknown>).access_token_encrypted);
    expect(cas?.filters.map(([, column]) => column)).toEqual(["id", "refresh_lease", "refresh_token_encrypted"]);
  });

  it("two concurrent publishers refresh once and both get the new token", async () => {
    const { db, channel } = channelDb();
    const refresher = vi.fn(async () => {
      await tick();
      await tick();
      return { accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 7200 };
    });
    const opts = { now: () => NOW, refreshers: { x: refresher }, sleep: tick };
    const [a, b] = await Promise.all([
      getChannelAccessToken(db.client, channel(), opts),
      getChannelAccessToken(db.client, channel(), opts)
    ]);
    expect([a, b]).toEqual(["new-access", "new-access"]);
    expect(refresher).toHaveBeenCalledTimes(1); // the spent refresh token is never presented twice
  });

  it("marks the channel 'reconnect required' when the provider rejects the refresh token", async () => {
    const { db, row, channel } = channelDb();
    const refresher = vi.fn(async () => {
      throw new TokenRefreshError("x", "X token refresh failed: 400 (invalid_request)", { grantRejected: true, status: 400 });
    });
    const err = await getChannelAccessToken(db.client, channel(), { now: () => NOW, refreshers: { x: refresher } }).catch((e) => e);
    expect(err).toBeInstanceOf(ChannelTokenError);
    expect(err).toMatchObject({ code: "reconnect_required" });
    expect(row.token_invalid_at).not.toBeNull();
    // once rejected, no further refresh attempts (a reconnect clears the marker)
    await expect(getChannelAccessToken(db.client, { ...row } as ChannelRow, { now: () => NOW, refreshers: { x: refresher } })).rejects.toMatchObject({
      code: "reconnect_required"
    });
    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it("does not flag a reconnect for a transient refresh failure", async () => {
    const { db, row, channel } = channelDb();
    const refresher = vi.fn(async () => {
      throw new TokenRefreshError("x", "X token refresh did not complete");
    });
    await expect(getChannelAccessToken(db.client, channel(), { now: () => NOW, refreshers: { x: refresher } })).rejects.toMatchObject({
      code: "refresh_failed"
    });
    expect(row.token_invalid_at).toBeNull();
    expect(row.refresh_lease).toBeNull(); // lease released for the next try
  });

  it("never overwrites a reconnect that happened while it was refreshing", async () => {
    const { db, row, channel } = channelDb();
    const refresher = vi.fn(async () => {
      // the merchant reconnects X meanwhile (OAuth callback writes a new pair)
      Object.assign(row, {
        access_token_encrypted: encryptSecret("reconnected-access"),
        refresh_token_encrypted: encryptSecret("reconnected-refresh"),
        token_expires_at: new Date(NOW + 7200_000).toISOString()
      });
      return { accessToken: "stale-new-access", refreshToken: "stale-new-refresh", expiresIn: 7200 };
    });
    await expect(getChannelAccessToken(db.client, channel(), { now: () => NOW, refreshers: { x: refresher } })).resolves.toBe(
      "reconnected-access"
    );
    expect(decryptSecret(row.refresh_token_encrypted)).toBe("reconnected-refresh");
  });

  it("refreshes after a 401 even when the stored expiry looks fine", async () => {
    const { db, channel } = channelDb({ token_expires_at: new Date(NOW + 3600_000).toISOString() });
    const refresher = vi.fn(async () => ({ accessToken: "after-401", refreshToken: "r2", expiresIn: 7200 }));
    await expect(
      getChannelAccessToken(db.client, channel(), { now: () => NOW, refreshers: { x: refresher }, rejectedToken: "old-access" })
    ).resolves.toBe("after-401");
  });

  it("asks for a reconnect when an expired token has no refresh token (pasted tokens, LinkedIn)", async () => {
    const { db, channel } = channelDb({ platform: "linkedin", refresh_token_encrypted: null });
    await expect(getChannelAccessToken(db.client, channel(), { now: () => NOW })).rejects.toMatchObject({ code: "reconnect_required" });
    expect(db.rpcCalls).toHaveLength(0);
  });
});

describe("provider refresh grants", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("X_CLIENT_ID", "x-client");
    vi.stubEnv("X_CLIENT_SECRET", "x-secret");
    vi.stubEnv("TIKTOK_CLIENT_KEY", "tt-key");
    vi.stubEnv("TIKTOK_CLIENT_SECRET", "tt-secret");
  });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("X: refresh_token grant at api.x.com with Basic client auth", async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: "xa", refresh_token: "xr", expires_in: 7200, token_type: "bearer" }));
    await expect(refreshXToken("old")).resolves.toEqual({ accessToken: "xa", refreshToken: "xr", expiresIn: 7200 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(X_TOKEN_URL);
    expect((init!.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("x-client:x-secret").toString("base64")}`);
    expect(Object.fromEntries(new URLSearchParams(String(init!.body)))).toEqual({ grant_type: "refresh_token", refresh_token: "old" });
  });

  it("X: a rejected refresh token asks for a reconnect; a platform credential problem does not", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "invalid_request", error_description: "Value passed for the token was invalid." }, 400));
    await expect(refreshXToken("spent")).rejects.toMatchObject({ grantRejected: true, status: 400 });
    fetchMock.mockResolvedValueOnce(json({ error: "unauthorized_client", error_description: "Missing valid authorization header" }, 401));
    await expect(refreshXToken("ok")).rejects.toMatchObject({ grantRejected: false, status: 401 });
  });

  it("TikTok: refresh body is flat JSON; an OAuth error in a 200 is still an error", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ access_token: "act.1", expires_in: 86400, open_id: "o", refresh_expires_in: 31536000, refresh_token: "rft.2", scope: "user.info.basic", token_type: "Bearer" })
    );
    await expect(refreshTikTokToken("rft.1")).resolves.toEqual({ accessToken: "act.1", refreshToken: "rft.2", expiresIn: 86400 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(TIKTOK_TOKEN_URL);
    expect(Object.fromEntries(new URLSearchParams(String(init!.body)))).toEqual({
      client_key: "tt-key",
      client_secret: "tt-secret",
      grant_type: "refresh_token",
      refresh_token: "rft.1"
    });

    fetchMock.mockResolvedValueOnce(json({ error: "invalid_grant", error_description: "Refresh token is invalid or expired.", log_id: "x" }));
    await expect(refreshTikTokToken("rft.spent")).rejects.toMatchObject({ grantRejected: true });
  });

  it("TikTok: the code exchange reads the documented flat token body", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ access_token: "act.example", expires_in: 86400, open_id: "open-1", refresh_expires_in: 31536000, refresh_token: "rft.example", scope: "user.info.basic,video.publish", token_type: "Bearer" })
    );
    await expect(exchangeTikTokCode("code", "verifier")).resolves.toMatchObject({ access_token: "act.example", open_id: "open-1", refresh_token: "rft.example" });
  });
});
