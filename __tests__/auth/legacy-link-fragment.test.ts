/**
 * RA-2: the implicit-flow "rescue" signed the browser into whatever account's tokens were in
 * the URL fragment (a link to /#access_token=…&refresh_token=… = login CSRF / session swap).
 * It is gone: nothing issues implicit-flow links any more (PKCE + token-hash templates), so a
 * fragment carrying tokens is never used. /login and / strip it from the address bar and show
 * a fixed bilingual "this link format is no longer supported" message.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyAuthFragment,
  consumeAuthFragment,
  fragmentNoticeCode,
  legacyLinkNoticeContent
} from "@/lib/auth/auth-fragment";
import { LOGIN_ERROR_MESSAGES } from "@/lib/auth/login-errors";

const LEGACY = "#access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLUIifQ.sig&expires_in=3600&refresh_token=refresh-B&token_type=bearer&type=magiclink";

function fakeWindow(pathname: string, search: string, hash: string) {
  const replaceState = vi.fn<(data: unknown, unused: string, url?: string | URL | null) => void>();
  return { location: { pathname, search, hash }, history: { state: { __NA: true, tree: "x" } as unknown, replaceState } };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("classifyAuthFragment", () => {
  it("flags an old implicit-flow token fragment without handing out the tokens", () => {
    const fragment = classifyAuthFragment(LEGACY);
    expect(fragment).toEqual({ kind: "legacy_tokens" });
    expect(JSON.stringify(fragment)).not.toContain("refresh-B");
    expect(JSON.stringify(fragment)).not.toContain("eyJ");
  });

  it.each(["#access_token=only", "#refresh_token=rt", "access_token=a&refresh_token=b", "#provider_token=p&x=1", "#access_token="])(
    "treats any credential-bearing fragment (%s) as a legacy link",
    (hash) => {
      expect(classifyAuthFragment(hash)).toEqual({ kind: "legacy_tokens" });
    }
  );

  it("maps Supabase's error fragments to stable codes", () => {
    expect(classifyAuthFragment("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid")).toEqual({
      kind: "error",
      code: "link_expired"
    });
    expect(classifyAuthFragment("#error=server_error")).toEqual({ kind: "error", code: "auth_unavailable" });
  });

  it("ignores ordinary anchors and empty or oversized fragments", () => {
    for (const hash of [null, undefined, "", "#", "#pricing", "#faq?x=1", `#${"a".repeat(20_000)}`]) {
      expect(classifyAuthFragment(hash)).toBeNull();
    }
  });

  it("still recognises (so the page strips) credentials in a padded, oversized fragment", () => {
    expect(classifyAuthFragment(`#access_token=a&pad=${"a".repeat(20_000)}`)).toEqual({ kind: "legacy_tokens" });
    expect(classifyAuthFragment(`#pad=${"a".repeat(20_000)}&refresh_token=b`)).toEqual({ kind: "legacy_tokens" });
  });
});

describe("consumeAuthFragment", () => {
  it("removes a token fragment from the address bar and history, keeping path, query and router state", () => {
    const win = fakeWindow("/login", "?next=%2Fbilling", LEGACY);
    expect(consumeAuthFragment(win)).toEqual({ kind: "legacy_tokens" });
    expect(win.history.replaceState).toHaveBeenCalledTimes(1);
    expect(win.history.replaceState).toHaveBeenCalledWith(win.history.state, "", "/login?next=%2Fbilling");
  });

  it("removes an error fragment too, and leaves ordinary anchors alone", () => {
    const error = fakeWindow("/", "", "#error=access_denied&error_code=otp_expired");
    expect(consumeAuthFragment(error)).toEqual({ kind: "error", code: "link_expired" });
    expect(error.history.replaceState).toHaveBeenCalledWith(error.history.state, "", "/");

    const anchor = fakeWindow("/", "?lang=ar", "#pricing");
    expect(consumeAuthFragment(anchor)).toBeNull();
    expect(anchor.history.replaceState).not.toHaveBeenCalled();
  });

  it("never sends the tokens anywhere", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    consumeAuthFragment(fakeWindow("/", "", LEGACY));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("fragmentNoticeCode", () => {
  it("shows the fixed 'no longer supported' message for token fragments", () => {
    expect(fragmentNoticeCode({ kind: "legacy_tokens" }, null)).toBe("link_unsupported");
    // Even when /login already carries an error code: the token link itself is what failed.
    expect(fragmentNoticeCode({ kind: "legacy_tokens" }, "link_expired")).toBe("link_unsupported");
  });

  it("shows an error fragment's code unless the query already explains the failure", () => {
    expect(fragmentNoticeCode({ kind: "error", code: "link_expired" }, null)).toBe("link_expired");
    expect(fragmentNoticeCode({ kind: "error", code: "link_expired" }, "link_expired")).toBeNull();
    expect(fragmentNoticeCode(null, null)).toBeNull();
  });

  it("has fixed bilingual text for the new codes", () => {
    expect(LOGIN_ERROR_MESSAGES.link_unsupported.en).toMatch(/no longer supported/i);
    expect(LOGIN_ERROR_MESSAGES.link_unsupported.en).toMatch(/new sign-in link/i);
    expect(LOGIN_ERROR_MESSAGES.link_unsupported.ar).toMatch(/[؀-ۿ]/);
    expect(LOGIN_ERROR_MESSAGES.cross_site.ar).toMatch(/[؀-ۿ]/);
  });
});

describe("legacyLinkNoticeContent (landing page banner)", () => {
  it("is the fixed bilingual message plus a link to request a new sign-in link", () => {
    expect(legacyLinkNoticeContent("link_unsupported")).toEqual({
      message: LOGIN_ERROR_MESSAGES.link_unsupported,
      action: { href: "/login", label: { ar: expect.stringMatching(/[؀-ۿ]/), en: "Request a new sign-in link" } }
    });
    expect(legacyLinkNoticeContent("link_expired").message).toEqual(LOGIN_ERROR_MESSAGES.link_expired);
  });

  it("is wired into / and /login (and the old rescue is not)", () => {
    const landing = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
    const login = readFileSync(join(process.cwd(), "app/(auth)/login/page.tsx"), "utf8");
    expect(landing).toContain("<LegacyLinkNotice />");
    expect(login).toMatch(/const authFragment = useAuthFragment\(\);\s+const fragmentError = fragmentNoticeCode\(authFragment, linkError\);/);
    expect(login).toMatch(/fragmentError \?\? linkError/);
    for (const src of [landing, login]) expect(src).not.toContain("ImplicitSessionRescue");
  });
});

describe("no implicit-token sign-in path is left", () => {
  const ROOT = process.cwd();
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
  }

  it("removed the rescue route, its server logic and its client component", () => {
    expect(existsSync(join(ROOT, "app/auth/session/route.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "lib/auth/session-rescue.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "components/auth/implicit-session-rescue.tsx"))).toBe(false);
  });

  it("has no code that posts URL tokens to the server or turns them into a session", () => {
    const sources = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components")), ...walk(join(ROOT, "lib")), join(ROOT, "middleware.ts")];
    expect(sources.length).toBeGreaterThan(50);
    for (const file of sources) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/["'`]\/auth\/session["'`]/);
      expect(src, file).not.toMatch(/\.setSession\s*\(/);
    }
  });
});
