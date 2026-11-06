/**
 * critic-7: one Graph API version, set in lib/meta/graph.ts (META_GRAPH_VERSION overrides it).
 * The scan below fails on any versioned facebook.com URL, any graph.facebook.com host or any
 * META_GRAPH_VERSION read outside that module, so a call site can never pin an expiring version.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GRAPH_VERSION,
  facebookOAuthDialogUrl,
  graphErrorBody,
  graphUrl,
  graphVersion
} from "@/lib/meta/graph";

const ROOT = path.resolve(__dirname, "../..");
const GRAPH_MODULE = path.join("lib", "meta", "graph.ts");
const SCANNED_DIRS = ["app", "lib", "components", "hooks", "scripts"];
const SCANNED_FILES = ["middleware.ts", "instrumentation.ts", "next.config.mjs"];
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (CODE_EXT.test(name)) out.push(full);
  }
  return out;
}

function codeFiles(): string[] {
  const files = SCANNED_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  for (const f of SCANNED_FILES) {
    try {
      if (statSync(path.join(ROOT, f)).isFile()) files.push(path.join(ROOT, f));
    } catch {
      // optional file
    }
  }
  return files;
}

afterEach(() => {
  delete process.env.META_GRAPH_VERSION;
});

describe("graphVersion", () => {
  it("defaults to a version Meta still supports (v26.0, newest in the changelog)", () => {
    expect(DEFAULT_GRAPH_VERSION).toBe("v26.0");
    expect(graphVersion()).toBe("v26.0");
  });

  it("is overridable at call time and normalises a missing 'v'", () => {
    process.env.META_GRAPH_VERSION = "v25.0";
    expect(graphVersion()).toBe("v25.0");
    process.env.META_GRAPH_VERSION = "24.0";
    expect(graphVersion()).toBe("v24.0");
  });

  it("ignores a malformed override instead of building broken URLs", () => {
    process.env.META_GRAPH_VERSION = "latest/../../evil";
    expect(graphVersion()).toBe(DEFAULT_GRAPH_VERSION);
  });
});

describe("URL helpers", () => {
  it("builds Graph URLs, encoding path segments and dropping empty query values", () => {
    expect(graphUrl("me/accounts", { fields: "id,name", access_token: "t", skip: undefined })).toBe(
      "https://graph.facebook.com/v26.0/me/accounts?fields=id%2Cname&access_token=t"
    );
    expect(graphUrl(["104", "messages"])).toBe("https://graph.facebook.com/v26.0/104/messages");
    expect(graphUrl(["../admin", "x"])).toBe("https://graph.facebook.com/v26.0/..%2Fadmin/x");
  });

  it("builds the Facebook Login dialog URL with the same version", () => {
    process.env.META_GRAPH_VERSION = "v25.0";
    expect(facebookOAuthDialogUrl(new URLSearchParams({ client_id: "1", state: "s" }))).toBe(
      "https://www.facebook.com/v25.0/dialog/oauth?client_id=1&state=s"
    );
  });

  it("parses Graph error bodies defensively", () => {
    expect(graphErrorBody({ error: { message: "m", code: 190, error_subcode: 463, fbtrace_id: "t" } })).toMatchObject({
      message: "m",
      code: 190,
      error_subcode: 463,
      fbtrace_id: "t"
    });
    expect(graphErrorBody({ error: "nope" })).toBeUndefined();
    expect(graphErrorBody(null)).toBeUndefined();
  });
});

describe("no Graph version or host outside lib/meta/graph.ts", () => {
  const files = codeFiles();

  it("scans the app's code", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith(GRAPH_MODULE))).toBe(true);
  });

  it.each([
    ["a versioned facebook.com URL", /facebook\.com\/v\d/],
    ["the graph.facebook.com host", /graph\.facebook\.com/],
    // (the admin secret registry declares the key; only env reads are forbidden)
    ["a META_GRAPH_VERSION env read", /process\.env(\.META_GRAPH_VERSION|\[["']META_GRAPH_VERSION)/]
  ])("finds no %s elsewhere", (_label, pattern) => {
    const offenders = files
      .filter((f) => !f.endsWith(GRAPH_MODULE))
      .filter((f) => pattern.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
