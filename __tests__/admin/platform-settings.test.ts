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

import {
  getAllPlatformSettings,
  getAgentSettings,
  getFeatureSettings,
  normalizeAgentSettings,
  normalizeFeatureSettings
} from "@/lib/admin/platform-settings";
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

describe("stored settings are merged per agent and validated", () => {
  it("fills fields a partial or legacy row lacks instead of leaving them undefined", async () => {
    // A legacy row: social carries the retired cronMinutes and no maxPostsPerRun; seo is missing.
    maybeSingle.mockResolvedValueOnce({
      data: { value: { social: { enabled: false, cronMinutes: 30 }, voice: { defaultDialect: "msa" } } },
      error: null
    });
    const agents = await getAgentSettings();
    expect(agents).toEqual({
      social: { enabled: false, maxPostsPerRun: 50 },
      voice: { enabled: true, defaultDialect: "msa" },
      seo: { enabled: true, model: "gpt-4o-mini", residency: "global" }
    });
  });

  it("falls back per field on invalid values and drops unknown ones", () => {
    expect(
      normalizeAgentSettings({
        social: { enabled: "yes", maxPostsPerRun: 0, extra: 1 },
        voice: { enabled: false, defaultDialect: "french" },
        seo: { enabled: false, model: "  ", residency: "us" }
      })
    ).toEqual({
      social: { enabled: true, maxPostsPerRun: 50 },
      voice: { enabled: false, defaultDialect: "khaliji" },
      seo: { enabled: false, model: "gpt-4o-mini", residency: "global" }
    });
    expect(normalizeAgentSettings(null).social.maxPostsPerRun).toBe(50);
    expect(normalizeAgentSettings({ social: { maxPostsPerRun: 200.5 } }).social.maxPostsPerRun).toBe(50);
    expect(normalizeAgentSettings({ social: { maxPostsPerRun: 120 } }).social.maxPostsPerRun).toBe(120);
  });

  it("keeps a feature on unless it is explicitly switched off", async () => {
    expect(normalizeFeatureSettings({ zatca: false, wathq: "off" })).toEqual({
      billing: true,
      zatca: false,
      wathq: true,
      socialOAuth: true
    });
    maybeSingle.mockResolvedValueOnce({ data: { value: { billing: false } }, error: null });
    expect(await getFeatureSettings()).toEqual({ billing: false, zatca: true, wathq: true, socialOAuth: true });
  });

  it("the editor read applies the same normalization", async () => {
    select.mockResolvedValueOnce({
      data: [{ key: "agents", value: { social: { enabled: false } }, updated_at: "t" }],
      error: null
    });
    const s = await getAllPlatformSettings();
    expect(s.agents.social).toEqual({ enabled: false, maxPostsPerRun: 50 });
    expect(s.features.zatca).toBe(true);
  });

  it("PATCH ignores the retired cronMinutes field instead of storing it", async () => {
    select.mockResolvedValueOnce({ data: [], error: null });
    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/config", {
        method: "PATCH",
        body: JSON.stringify({ agents: { social: { enabled: true, cronMinutes: 60, maxPostsPerRun: 20 } } })
      })
    );
    expect(res.status).toBe(200);
    const written = (upsert.mock.calls[0] as unknown as [{ key: string; value: { social: Record<string, unknown> } }])[0];
    expect(written.key).toBe("agents");
    expect(written.value.social).toEqual({ enabled: true, maxPostsPerRun: 20 });
  });
});
