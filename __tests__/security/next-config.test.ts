/**
 * Guards the image-optimizer hardening in next.config.mjs.
 *
 * The optimizer must stay disabled (no next/image usage; /_next/image 404s before
 * sharp loads), remote patterns must never contain wildcard hosts, and the config
 * must remain valid for Next's own schema — an invalid `images` key makes both
 * `next build` and `next start` exit 1.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { configSchema } from "next/dist/server/config-schema.js";
import { hasRemoteMatch } from "next/dist/shared/lib/match-remote-pattern.js";
import type { RemotePattern } from "next/dist/shared/lib/image-config";

type ImagesConfig = { unoptimized?: boolean; dangerouslyAllowSVG?: boolean; remotePatterns: RemotePattern[] };

async function loadConfig(supabaseUrl: string | undefined): Promise<{ images: ImagesConfig }> {
  vi.resetModules();
  if (supabaseUrl === undefined) vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  else vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);
  const mod = (await import("../../next.config.mjs")) as { default: { images: ImagesConfig } };
  return mod.default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config.mjs image hardening", () => {
  it("keeps the optimizer disabled and SVG off", async () => {
    const cfg = await loadConfig("https://abcdefgh.supabase.co");
    expect(cfg.images.unoptimized).toBe(true);
    expect(cfg.images.dangerouslyAllowSVG).toBe(false);
  });

  it("is valid for Next's config schema", async () => {
    const cfg = await loadConfig("https://abcdefgh.supabase.co");
    const parsed = configSchema.safeParse(cfg);
    expect(parsed.success).toBe(true);
  });

  it("never uses wildcard remote hostnames", async () => {
    const cfg = await loadConfig("https://abcdefgh.supabase.co");
    for (const p of cfg.images.remotePatterns) {
      expect(p.hostname).not.toContain("*");
    }
  });

  it("only admits this project's public storage, not other Supabase projects", async () => {
    const cfg = await loadConfig("https://abcdefgh.supabase.co");
    const rp = cfg.images.remotePatterns;
    expect(hasRemoteMatch([], rp, new URL("https://abcdefgh.supabase.co/storage/v1/object/public/b/x.png"))).toBe(true);
    expect(hasRemoteMatch([], rp, new URL("https://attacker-proj.supabase.co/storage/v1/object/public/b/x.png"))).toBe(false);
    expect(hasRemoteMatch([], rp, new URL("https://abcdefgh.supabase.co/rest/v1/merchants"))).toBe(false);
    expect(hasRemoteMatch([], rp, new URL("https://salla.sa/x.png"))).toBe(false);
  });

  it("omits the Supabase pattern when the URL is unset", async () => {
    const cfg = await loadConfig(undefined);
    expect(cfg.images.remotePatterns.map((p) => p.hostname)).toEqual(["cdn.salla.sa"]);
  });
});
