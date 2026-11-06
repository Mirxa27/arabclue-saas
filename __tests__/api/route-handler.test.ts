import { describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { handleRouteError } from "@/lib/api/route-handler";
import { HttpError, notFound } from "@/lib/api/errors";
import { AuthError } from "@/lib/auth/session";

vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

describe("handleRouteError", () => {
  it("maps HttpError to its status and message", async () => {
    const res = handleRouteError(notFound("Employee"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Employee not found" });
    expect(handleRouteError(new HttpError(403, "Complete onboarding first")).status).toBe(403);
  });

  it("maps AuthError to 401", () => {
    expect(handleRouteError(new AuthError()).status).toBe(401);
  });

  it("rethrows Next.js redirect() instead of turning a navigation into a 500", () => {
    let thrown: unknown;
    try {
      redirect("/login");
    } catch (e) {
      thrown = e;
    }
    expect(() => handleRouteError(thrown)).toThrow();
  });

  it("returns 500 for unexpected errors", () => {
    expect(handleRouteError(new Error("boom")).status).toBe(500);
    expect(handleRouteError("weird").status).toBe(500);
  });
});

describe("requireMerchantApi", () => {
  it("throws 401 without a session and 403 without a merchant — never a redirect", async () => {
    vi.resetModules();
    const getUser = vi.fn();
    const maybeSingle = vi.fn();
    vi.doMock("@/lib/db/supabase", () => ({
      getServerSupabase: async () => ({
        auth: { getUser },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })
      })
    }));
    const { requireMerchantApi } = await import("@/lib/auth/session");
    const { HttpError: FreshHttpError } = await import("@/lib/api/errors");
    const { AuthError: FreshAuthError } = await import("@/lib/auth/session");

    getUser.mockResolvedValueOnce({ data: { user: null } });
    await expect(requireMerchantApi()).rejects.toBeInstanceOf(FreshAuthError);

    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    maybeSingle.mockResolvedValueOnce({ data: null });
    const err = await requireMerchantApi().catch((e) => e);
    expect(err).toBeInstanceOf(FreshHttpError);
    expect((err as HttpError).status).toBe(403);

    maybeSingle.mockResolvedValueOnce({ data: { id: "m1" } });
    expect(await requireMerchantApi()).toEqual({ id: "m1" });
    vi.doUnmock("@/lib/db/supabase");
  });
});
