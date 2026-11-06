import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  checkOAuthBinding,
  decodeOAuthFlowBinding,
  encodeOAuthFlowBinding,
  isHttpsRequest,
  newOAuthNonce,
  oauthFlowCookieName,
  readOAuthFlowCookie
} from "@/lib/oauth/flow-cookie";
import {
  OAUTH_ERROR_CODES,
  OAUTH_ERROR_MESSAGES,
  OAuthCallbackError,
  oauthErrorMessage,
  oauthFailureReport
} from "@/lib/oauth/errors";
import { oauthResultPath, parseOAuthResult } from "@/lib/oauth/result";

const ARABIC = /[؀-ۿ]/;

describe("OAuth flow cookie", () => {
  it("names the cookie per flow, __Host- prefixed on https", () => {
    expect(oauthFlowCookieName("employee", false)).toBe("ac_oauth_employee");
    expect(oauthFlowCookieName("salla", true)).toBe("__Host-ac_oauth_salla");
    expect(isHttpsRequest(new Request("https://arabclue.com/x"))).toBe(true);
    expect(isHttpsRequest(new Request("http://internal:3000/x", { headers: { "x-forwarded-proto": "https" } }))).toBe(true);
    expect(isHttpsRequest(new Request("http://localhost:3111/x"))).toBe(false);
  });

  it("round-trips nonce + verifier and rejects malformed values", () => {
    const nonce = newOAuthNonce();
    const verifier = "v".repeat(43);
    expect(decodeOAuthFlowBinding(encodeOAuthFlowBinding({ nonce }))).toEqual({ nonce });
    expect(decodeOAuthFlowBinding(encodeOAuthFlowBinding({ nonce, codeVerifier: verifier }))).toEqual({
      nonce,
      codeVerifier: verifier
    });
    for (const bad of [null, "", "short", "a.b.c", `${nonce}.bad verifier`, `${nonce};x=y`]) {
      expect(decodeOAuthFlowBinding(bad)).toBeNull();
    }
  });

  it("reads the cookie for the request's scheme only (no fallback to the unprefixed name on https)", () => {
    const nonce = newOAuthNonce();
    const httpsReq = new NextRequest("https://arabclue.com/api/oauth/x/callback", {
      headers: { cookie: `ac_oauth_x=${nonce}` } // e.g. planted by a sibling subdomain
    });
    expect(readOAuthFlowCookie(httpsReq, "x")).toBeNull();
    const ok = new NextRequest("https://arabclue.com/api/oauth/x/callback", {
      headers: { cookie: `__Host-ac_oauth_x=${nonce}` }
    });
    expect(readOAuthFlowCookie(ok, "x")).toEqual({ nonce });
  });

  it("binds to browser first, then to the signed-in merchant", () => {
    const nonce = newOAuthNonce();
    const base = { stateNonce: nonce, stateMerchantId: "m1", signedIn: true };
    expect(checkOAuthBinding({ ...base, binding: { nonce }, sessionMerchantId: "m1" })).toBeNull();
    expect(checkOAuthBinding({ ...base, binding: null, sessionMerchantId: "m1" })).toBe("state_mismatch");
    expect(checkOAuthBinding({ ...base, binding: { nonce: newOAuthNonce() }, sessionMerchantId: "m1" })).toBe(
      "state_mismatch"
    );
    expect(checkOAuthBinding({ ...base, signedIn: false, binding: { nonce }, sessionMerchantId: null })).toBe(
      "not_signed_in"
    );
    expect(checkOAuthBinding({ ...base, binding: { nonce }, sessionMerchantId: "m2" })).toBe("merchant_mismatch");
    // Signed in to an account without a merchant profile is a mismatch, not "signed out".
    expect(checkOAuthBinding({ ...base, binding: { nonce }, sessionMerchantId: null })).toBe("merchant_mismatch");
  });
});

describe("OAuth result contract", () => {
  it("builds result URLs with stable codes only", () => {
    expect(oauthResultPath("salla", { ok: true })).toBe("/integrations/callback?platform=salla&status=success");
    expect(oauthResultPath("meta", { ok: false, error: "state_mismatch" })).toBe(
      "/integrations/callback?platform=meta&status=error&error=state_mismatch"
    );
  });

  it("parses the page params and collapses unknown errors/platforms", () => {
    expect(parseOAuthResult(new URLSearchParams("platform=x&status=success"))).toEqual({
      platform: "x",
      ok: true,
      error: "unknown"
    });
    expect(
      parseOAuthResult(new URLSearchParams("platform=evil&status=error&error=Your%20store%20was%20deleted"))
    ).toEqual({ platform: null, ok: false, error: "unknown" });
    // Anything but an explicit success is a failure — no "success by default".
    expect(parseOAuthResult(new URLSearchParams("platform=salla")).ok).toBe(false);
  });

  it("shows fixed bilingual text and a generic fallback for crafted errors", () => {
    for (const code of OAUTH_ERROR_CODES) {
      expect(OAUTH_ERROR_MESSAGES[code].ar).toMatch(ARABIC);
      expect(OAUTH_ERROR_MESSAGES[code].en.length).toBeGreaterThan(10);
    }
    const crafted = "Call +966500000000 to restore your store";
    expect(oauthErrorMessage(crafted)).toEqual(OAUTH_ERROR_MESSAGES.unknown);
    expect(JSON.stringify(oauthErrorMessage(crafted))).not.toContain("+966");
    expect(oauthErrorMessage("store_already_linked")).toEqual(OAUTH_ERROR_MESSAGES.store_already_linked);
  });
});

describe("oauthFailureReport (server-side detail, never in the URL)", () => {
  it("reports the underlying cause and keeps non-Error details for the redacted extra", () => {
    const cause = new Error("LinkedIn token exchange failed: 401");
    expect(oauthFailureReport("token_exchange_failed", cause).error).toBe(cause);
    expect(
      oauthFailureReport("account_lookup_failed", new OAuthCallbackError("account_lookup_failed", cause)).error
    ).toBe(cause);

    const pgError = { code: "23505", message: "duplicate key value violates unique constraint" };
    const report = oauthFailureReport("store_already_linked", new OAuthCallbackError("store_already_linked", pgError));
    expect(report.error).toBeInstanceOf(OAuthCallbackError);
    expect(report.detail).toEqual(pgError);

    expect(oauthFailureReport("bad_state")).toEqual({ error: expect.any(OAuthCallbackError) });
  });
});
