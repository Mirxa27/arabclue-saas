import { describe, expect, it } from "vitest";
import {
  LOGIN_ERROR_CODES,
  LOGIN_ERROR_MESSAGES,
  loginErrorFromAuthError,
  loginErrorFromRedirectParams,
  loginErrorMessage
} from "@/lib/auth/login-errors";
import { parseAuthFragment } from "@/lib/auth/implicit-session";

const ARABIC = /[؀-ۿ]/;

describe("login error messages", () => {
  it("has fixed Arabic + English text for every code", () => {
    for (const code of LOGIN_ERROR_CODES) {
      const msg = LOGIN_ERROR_MESSAGES[code];
      expect(msg.ar).toMatch(ARABIC);
      expect(msg.en.length).toBeGreaterThan(10);
    }
  });

  it("maps unknown or crafted codes to the generic message, never echoing them", () => {
    const crafted = "Your account is suspended, call +966500000000";
    expect(loginErrorMessage(crafted)).toEqual(LOGIN_ERROR_MESSAGES.unknown);
    expect(loginErrorMessage(null)).toEqual(LOGIN_ERROR_MESSAGES.unknown);
    expect(JSON.stringify(loginErrorMessage(crafted))).not.toContain("suspended, call");
    expect(loginErrorMessage("link_expired")).toEqual(LOGIN_ERROR_MESSAGES.link_expired);
  });
});

describe("loginErrorFromAuthError", () => {
  it.each([
    ["otp_expired", "link_expired"],
    ["flow_state_expired", "link_expired"],
    ["flow_state_not_found", "link_expired"],
    ["pkce_code_verifier_not_found", "link_other_browser"],
    ["bad_code_verifier", "link_other_browser"],
    ["over_email_send_rate_limit", "rate_limited"],
    ["user_banned", "account_blocked"],
    ["signup_disabled", "signup_disabled"],
    ["email_address_invalid", "invalid_email"]
  ])("%s → %s", (authCode, expected) => {
    expect(loginErrorFromAuthError({ code: authCode, status: 400 })).toBe(expected);
  });

  it("falls back on HTTP status, then generic", () => {
    expect(loginErrorFromAuthError({ status: 429 })).toBe("rate_limited");
    expect(loginErrorFromAuthError({ status: 502 })).toBe("auth_unavailable");
    expect(loginErrorFromAuthError({ code: "something_new", status: 400 })).toBe("unknown");
  });
});

describe("loginErrorFromRedirectParams", () => {
  it("prefers Supabase's error_code and ignores error_description", () => {
    const params = new URLSearchParams(
      "error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"
    );
    expect(loginErrorFromRedirectParams(params)).toBe("link_expired");
  });

  it("maps a bare OAuth-style error and returns null without one", () => {
    expect(loginErrorFromRedirectParams(new URLSearchParams("error=access_denied"))).toBe("access_denied");
    expect(loginErrorFromRedirectParams(new URLSearchParams("error=weird"))).toBe("unknown");
    expect(loginErrorFromRedirectParams(new URLSearchParams("code=abc"))).toBeNull();
  });
});

describe("parseAuthFragment (implicit-flow rescue)", () => {
  it("extracts tokens from an old implicit magic-link fragment", () => {
    expect(
      parseAuthFragment("#access_token=at.x.y&expires_in=3600&refresh_token=rt1&token_type=bearer&type=magiclink")
    ).toEqual({ kind: "tokens", accessToken: "at.x.y", refreshToken: "rt1" });
  });

  it("maps fragment errors to stable codes", () => {
    expect(parseAuthFragment("#error=access_denied&error_code=otp_expired&error_description=x")).toEqual({
      kind: "error",
      code: "link_expired"
    });
  });

  it("ignores unrelated or partial fragments", () => {
    expect(parseAuthFragment("")).toBeNull();
    expect(parseAuthFragment("#pricing")).toBeNull();
    expect(parseAuthFragment("#access_token=only")).toBeNull();
  });
});
