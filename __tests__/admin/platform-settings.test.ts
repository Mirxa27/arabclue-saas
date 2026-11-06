import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const select = vi.hoisted(() => vi.fn());
const upsert = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const maybeSingle = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => ({
    from: () => ({
      select: (cols: string) => (cols === "value" ? { eq: () => ({ maybeSingle }) } : select()),
      upsert
    })
  })
}));
vi.mock("@/lib/auth/admin", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/admin")>()),
  requirePlatformAdminApi: vi.fn(async () => ({ id: "admin" }))
}));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn(), redactSensitive: (s: string) => s }));

import { getAllPlatformSettings, getAgentSettings } from "@/lib/admin/platform-settings";
import { PATCH } from "@/app/api/admin/config/route";

beforeEach(() => {
  select.mockReset();
  upsert.mockClear();
  maybeSingle.mockReset();
});

describe("platform settings reads (#34)", () => {
  it("throws on a read failure instead of returning all-enabled defaults", async () => {
    select.mockResolvedValueOnce({ data: null, error: { code: "57014", message: "statement timeout" } });
    await expect(getAllPlatformSettings()).rejects.toThrow(/statement timeout/);
  });

  it("still falls back to defaults when the table does not exist yet", async () => {
    select.mockResolvedValueOnce({ data: null, error: { code: "42P01", message: "missing" } });
    const s = await getAllPlatformSettings();
    expect(s.agents.social.enabled).toBe(true);
  });

  it("PATCH writes nothing when the current settings cannot be read", async () => {
    select.mockResolvedValueOnce({ data: null, error: { code: "57014", message: "statement timeout" } });
    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/config", {
        method: "PATCH",
        body: JSON.stringify({ agents: { social: { enabled: true } } })
      })
    );
    expect(res.status).toBe(500);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("PATCH merges onto the stored kill switches and returns what it wrote", async () => {
    select.mockResolvedValueOnce({
      data: [{ key: "agents", value: { social: { enabled: false, cronMinutes: 15, maxPostsPerRun: 50 } }, updated_at: "t" }],
      error: null
    });
    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/config", {
        method: "PATCH",
        body: JSON.stringify({ agents: { voice: { enabled: false } } })
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: { agents: { social: { enabled: boolean }; voice: { enabled: boolean } } } };
    expect(body.settings.agents.social.enabled).toBe(false); // stored value preserved, not reset to default
    expect(body.settings.agents.voice.enabled).toBe(false);
  });

  it("runtime gates keep defaults on a transient read error (availability) but report it", async () => {
    const { reportError } = await import("@/lib/observability/error-reporter");
    maybeSingle.mockResolvedValueOnce({ data: null, error: { code: "57014", message: "statement timeout" } });
    const agents = await getAgentSettings();
    expect(agents.social.enabled).toBe(true);
    expect(reportError).toHaveBeenCalled();
  });
});
