/**
 * lib/salla/oauth.ts against the documented shapes (docs.salla.dev/doc-421118, /merchants/user-info.md):
 * both expiry spellings, RFC 6749 error codes, and the installer identity from user/info.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import userInfo from "../fixtures/salla-user-info.json";
import {
  exchangeCodeForTokens,
  fetchSallaUserInfo,
  parseSallaTokenResponse,
  refreshTokens,
  sallaAPI,
  SallaApiError,
  sallaExpiryToDate,
  SallaOAuthError,
  SALLA_ACCESS_TOKEN_TTL_SEC
} from "@/lib/salla/oauth";

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: () => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return response();
    })
  );
  return calls;
}

describe("token responses", () => {
  it("accepts the documented code-exchange sample (`expires`, seconds) and refresh sample (`expires_in`)", () => {
    // docs.salla.dev/doc-421118 "Access Token Response"
    const exchange = parseSallaTokenResponse(
      { access_token: "ory_at_x", expires: 1209599, refresh_token: "ory_rt_x", scope: "offline_access", token_type: "bearer" },
      NOW
    );
    expect(exchange).toEqual({ access_token: "ory_at_x", refresh_token: "ory_rt_x", expires_in: 1209599, token_type: "bearer", scope: "offline_access" });
    // "Refresh Access Token Response"
    expect(parseSallaTokenResponse({ access_token: "a", expires_in: 1209599, refresh_token: "r", token_type: "bearer" }, NOW).expires_in).toBe(1209599);
  });

  it("falls back to the documented 14-day lifetime and tolerates a missing refresh token", () => {
    expect(parseSallaTokenResponse({ access_token: "a" }, NOW)).toEqual({ access_token: "a", expires_in: SALLA_ACCESS_TOKEN_TTL_SEC });
  });

  it("reads app.store.authorize's `expires` as a unix timestamp", () => {
    expect(sallaExpiryToDate(1634819484, NOW).toISOString()).toBe("2021-10-21T12:31:24.000Z");
    expect(sallaExpiryToDate(3600, NOW).getTime()).toBe(NOW + 3_600_000);
    expect(sallaExpiryToDate(undefined, NOW).getTime()).toBe(NOW + SALLA_ACCESS_TOKEN_TTL_SEC * 1000);
  });

  it("posts the documented grant parameters and surfaces the OAuth error code", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify({ error: "invalid_grant", error_description: "x" }), { status: 400 }));
    const err = await refreshTokens({ clientId: "id", clientSecret: "secret", refreshToken: "rt" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SallaOAuthError);
    expect(err).toMatchObject({ status: 400, oauthError: "invalid_grant", grantRejected: true, message: "Salla refresh failed: 400 (invalid_grant)" });
    expect(calls[0].url).toBe("https://accounts.salla.sa/oauth2/token");
    const body = new URLSearchParams(String(calls[0].init?.body));
    expect(Object.fromEntries(body)).toEqual({ grant_type: "refresh_token", client_id: "id", client_secret: "secret", refresh_token: "rt" });

    stubFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));
    const gateway = await exchangeCodeForTokens({ clientId: "id", clientSecret: "s", redirectUri: "https://x/cb", code: "c" }).catch(
      (e: unknown) => e
    );
    expect(gateway).toMatchObject({ status: 502, oauthError: undefined, grantRejected: false, message: "Salla token exchange failed: 502" });
  });
});

describe("user/info", () => {
  it("reads the documented sample: store id/name/domain plus the authorizing user's email and role", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify(userInfo), { status: 200 }));
    expect(await fetchSallaUserInfo("at")).toEqual({
      storeId: "847769313",
      storeName: "User Name",
      storeDomain: "https://www.domain.com",
      userEmail: "test@gmail.com",
      userRole: "user"
    });
    expect(calls[0].url).toBe("https://accounts.salla.sa/oauth2/user/info");
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe("Bearer at");
  });

  it("accepts the `store` spelling of the other documented example and normalises email / role", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({ data: { id: 1, email: "  Team@Store.SA ", role: "team", store: { id: 847769313, name: "تين و زيتون" } } }),
          { status: 200 }
        )
    );
    expect(await fetchSallaUserInfo("at")).toMatchObject({ storeId: "847769313", userEmail: "team@store.sa", userRole: "team" });
  });

  it("throws on non-2xx", async () => {
    stubFetch(() => new Response("{}", { status: 401 }));
    await expect(fetchSallaUserInfo("at")).rejects.toMatchObject({ name: "SallaApiError", status: 401 });
  });
});

describe("sallaAPI", () => {
  it("throws a typed error without the query string (customer phone numbers stay out of logs)", async () => {
    stubFetch(() => new Response("{}", { status: 404 }));
    const err = await sallaAPI("/orders?phone=%2B966500000000", "at").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SallaApiError);
    expect((err as Error).message).toBe("Salla /orders → 404");
  });
});
