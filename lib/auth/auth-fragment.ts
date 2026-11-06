/**
 * Auth data in the URL fragment, which the server never sees.
 *
 * - `#access_token=…&refresh_token=…`: a magic link from before the PKCE switch (implicit
 *   flow). Nothing issues these any more (PKCE + token-hash email templates), and they are
 *   NEVER used: anyone can link to `/#access_token=<their own tokens>`, so turning a fragment
 *   into a session would sign visitors into someone else's account (login CSRF). The page
 *   strips the fragment and asks for a new link (`link_unsupported`).
 * - `#error=…&error_code=…`: Supabase appends this to every failed link's redirect (next to
 *   the query for PKCE links). Mapped to a stable code; `error_description` is ignored.
 *
 * Pure module — safe to import from client components.
 */
import {
  loginErrorFromRedirectParams,
  loginErrorMessage,
  type BilingualText,
  type LoginErrorCode
} from "@/lib/auth/login-errors";

export type AuthFragment = { kind: "legacy_tokens" } | { kind: "error"; code: LoginErrorCode };

const MAX_FRAGMENT_LENGTH = 16_384;
const CREDENTIAL_PARAMS = ["access_token", "refresh_token", "provider_token", "provider_refresh_token"] as const;
const CREDENTIAL_RE = new RegExp(`(?:^|[&#])(?:${CREDENTIAL_PARAMS.join("|")})=`);

/** What an auth fragment is — never the tokens themselves. Null for ordinary anchors. */
export function classifyAuthFragment(hash: string | null | undefined): AuthFragment | null {
  if (!hash) return null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  // Too long to parse: still recognise (and strip) credentials, ignore anything else.
  if (raw.length > MAX_FRAGMENT_LENGTH) return CREDENTIAL_RE.test(raw) ? { kind: "legacy_tokens" } : null;

  const params = new URLSearchParams(raw);
  if (CREDENTIAL_PARAMS.some((name) => params.has(name))) return { kind: "legacy_tokens" };

  const error = loginErrorFromRedirectParams(params);
  return error ? { kind: "error", code: error } : null;
}

export type FragmentWindow = {
  location: { pathname: string; search: string; hash: string };
  history: { state: unknown; replaceState(data: unknown, unused: string, url?: string | URL | null): void };
};

/**
 * Reads an auth fragment once and removes it from the address bar and history (keeping the
 * path, query and the router's history state), so tokens or Supabase's error text never
 * linger. Returns what it was; ordinary anchors (#pricing) are left alone.
 */
export function consumeAuthFragment(win: FragmentWindow): AuthFragment | null {
  const fragment = classifyAuthFragment(win.location.hash);
  if (!fragment) return null;
  win.history.replaceState(win.history.state, "", `${win.location.pathname}${win.location.search}`);
  return fragment;
}

/**
 * The sign-in message to show for a consumed fragment. A token fragment always means the old
 * link format; an error fragment adds nothing when the query already carries `?error=` (the
 * browser keeps the fragment across our /auth/callback → /login?error=… redirect).
 */
export function fragmentNoticeCode(fragment: AuthFragment | null, queryError: string | null): LoginErrorCode | null {
  if (!fragment) return null;
  if (fragment.kind === "legacy_tokens") return "link_unsupported";
  return queryError ? null : fragment.code;
}

export type LegacyLinkNoticeContent = { message: BilingualText; action: { href: "/login"; label: BilingualText } };

/** What the landing page shows for an unusable link: fixed text only, never anything from the URL. */
export function legacyLinkNoticeContent(code: LoginErrorCode): LegacyLinkNoticeContent {
  return {
    message: loginErrorMessage(code),
    action: { href: "/login", label: { ar: "اطلب رابط دخول جديدًا", en: "Request a new sign-in link" } }
  };
}
