/**
 * Meta Graph API: the one place the API version and hosts live.
 *
 * Every Graph / Facebook Login URL in the app is built here, so a version bump is a
 * one-line change (or an admin-config change, see META_GRAPH_VERSION). A unit test
 * (__tests__/meta/graph-version.test.ts) fails on any versioned facebook.com literal
 * anywhere else in the code.
 *
 * Default version: v26.0. Meta's version table
 * (https://developers.facebook.com/docs/graph-api/changelog/versions, read 2026-11-06)
 * lists v26.0 released July 29, 2026 with expiry "TBD" (the newest), v25.0 available
 * until July 29, 2028, v24.0 until February 18, 2028, v21.0 until January 21, 2027 and
 * v20.0 until September 24, 2026 (expired). The v22.0–v26.0 changelogs list no breaking
 * change to the endpoints used here (Facebook Login, /me/accounts, /me/businesses,
 * WhatsApp Cloud API messages + phone numbers, Page Send API, subscribed_apps,
 * Instagram content publishing).
 *
 * META_GRAPH_VERSION (env or /admin/config) overrides the default. It is read on every
 * call, not at import time, so an admin change applies once the env is re-hydrated.
 */

export const DEFAULT_GRAPH_VERSION = "v26.0";
export const GRAPH_API_HOST = "https://graph.facebook.com";
export const FACEBOOK_WEB_HOST = "https://www.facebook.com";

const VERSION_RE = /^v?(\d{1,3})\.(\d{1,2})$/;

/** The Graph API version to call, e.g. "v26.0". Invalid overrides fall back to the default. */
export function graphVersion(): string {
  const configured = process.env.META_GRAPH_VERSION?.trim();
  if (!configured) return DEFAULT_GRAPH_VERSION;
  const match = VERSION_RE.exec(configured);
  return match ? `v${match[1]}.${match[2]}` : DEFAULT_GRAPH_VERSION;
}

export type GraphQuery = Record<string, string | number | boolean | null | undefined>;

function queryString(query?: GraphQuery | URLSearchParams): string {
  if (!query) return "";
  const params =
    query instanceof URLSearchParams
      ? query
      : new URLSearchParams(
          Object.entries(query)
            .filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => [k, String(v)])
        );
  const s = params.toString();
  return s ? `?${s}` : "";
}

/**
 * `https://graph.facebook.com/<version>/<path>?<query>`.
 * Pass the path as segments to have each one URL-encoded (ids from storage or input).
 */
export function graphUrl(path: string | readonly string[], query?: GraphQuery | URLSearchParams): string {
  const clean =
    typeof path === "string"
      ? path.replace(/^\/+/, "")
      : path.map((segment) => encodeURIComponent(segment)).join("/");
  return `${GRAPH_API_HOST}/${graphVersion()}/${clean}${queryString(query)}`;
}

/** Facebook Login dialog: `https://www.facebook.com/<version>/dialog/oauth?<query>`. */
export function facebookOAuthDialogUrl(query: GraphQuery | URLSearchParams): string {
  return `${FACEBOOK_WEB_HOST}/${graphVersion()}/dialog/oauth${queryString(query)}`;
}

// ─── Errors ────────────────────────────────────────────────────────────────

/** The `error` object of a Graph API error response. */
export type GraphErrorBody = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  error_user_title?: string;
  error_user_msg?: string;
};

/** Extract `{ error: {...} }` from a parsed Graph response, if present. */
export function graphErrorBody(json: unknown): GraphErrorBody | undefined {
  if (!json || typeof json !== "object") return undefined;
  const err = (json as { error?: unknown }).error;
  if (!err || typeof err !== "object") return undefined;
  const e = err as Record<string, unknown>;
  return {
    message: typeof e.message === "string" ? e.message : undefined,
    type: typeof e.type === "string" ? e.type : undefined,
    code: typeof e.code === "number" ? e.code : undefined,
    error_subcode: typeof e.error_subcode === "number" ? e.error_subcode : undefined,
    fbtrace_id: typeof e.fbtrace_id === "string" ? e.fbtrace_id : undefined,
    error_user_title: typeof e.error_user_title === "string" ? e.error_user_title : undefined,
    error_user_msg: typeof e.error_user_msg === "string" ? e.error_user_msg : undefined
  };
}

/** A failed Graph API call, with Meta's numeric code/subcode kept for classification. */
export class GraphApiError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly subcode?: number;
  readonly errorType?: string;
  readonly fbtraceId?: string;

  constructor(label: string, status: number, body: GraphErrorBody | undefined, fallback = "request failed") {
    super(`${label}: ${body?.message ?? fallback}`);
    this.name = "GraphApiError";
    this.status = status;
    this.code = body?.code;
    this.subcode = body?.error_subcode;
    this.errorType = body?.type;
    this.fbtraceId = body?.fbtrace_id;
  }
}
