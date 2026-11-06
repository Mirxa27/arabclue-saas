/**
 * Token-hash links must not silently replace an existing session (login CSRF), and
 * email links must never continue straight into an API route.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  verifyOtp: vi.fn(async () => ({ error: null })),
  exchangeCodeForSession: vi.fn(async () => ({ error: null }))
}));
vi.mock("@/lib/db/supabase", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/supabase")>()),
  createRouteHandlerSupabase: () => ({ auth, applyCookies: (res: Response) => res })
}));
vi.mock("@/lib/auth/sign-in-limits", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/sign-in-limits")>()),
  limitSignInByIp: vi.fn(async () => false)
}));

import { completeEmailSignIn, emailLinkLandingPath } from "@/lib/auth/email-callback";

const confirm = (qs: string) => completeEmailSignIn(new NextRequest(`http://localhost:3111/auth/confirm?${qs}`), "test");

beforeEach(() => {
  auth.getUser.mockReset();
  auth.verifyOtp.mockClear();
  auth.exchangeCodeForSession.mockClear();
});

describe("token-hash link while another account is signed in", () => {
  it("does not consume the link; sends the visitor to /auth/switch", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "user-a" } } });
    const res = await confirm("token_hash=abc&type=email&next=%2Fdashboard");
    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith("/auth/switch?")).toBe(true);
    expect(new URLSearchParams(location.split("?")[1]).get("token_hash")).toBe("abc");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("uses the link after the visitor explicitly chose to switch", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "user-a" } } });
    const res = await confirm("token_hash=abc&type=email&next=%2Fdashboard&switch=1");
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
    expect(res.headers.get("location")).toBe("/dashboard");
  });

  it("signs in normally when nobody is signed in", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });
    await confirm("token_hash=abc&type=email&next=%2Fdashboard");
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
  });

  it("does not apply to browser-bound PKCE code links", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "user-a" } } });
    await completeEmailSignIn(new NextRequest("http://localhost:3111/auth/callback?code=xyz&next=%2Fdashboard"), "test");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(auth.getUser).not.toHaveBeenCalled();
  });
});

describe("email links never land on API routes", () => {
  it("maps OAuth start routes to the page that offers the connect button", () => {
    expect(emailLinkLandingPath("/api/oauth/meta/start?target=instagram")).toBe("/integrations");
    expect(emailLinkLandingPath("/api/salla/oauth/start")).toBe("/integrations");
    expect(emailLinkLandingPath("/api/employees/8f2c1d4e-7a3b-4c9d-8e1f-2a3b4c5d6e7f/oauth/gmail/start")).toBe(
      "/employees/8f2c1d4e-7a3b-4c9d-8e1f-2a3b4c5d6e7f?tab=integrations"
    );
    expect(emailLinkLandingPath("/api/merchant/export")).toBe("/dashboard");
    expect(emailLinkLandingPath("/settings")).toBe("/settings");
  });

  it("a confirmed link with next=/api/... lands on a page", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });
    const res = await confirm("token_hash=abc&type=email&next=%2Fapi%2Foauth%2Fmeta%2Fstart");
    expect(res.headers.get("location")).toBe("/integrations");
  });
});
