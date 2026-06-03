type ErrorContext = {
  route?: string;
  userId?: string;
  merchantId?: string;
  status?: number;
  extra?: Record<string, unknown>;
};

const REDACTED = "[REDACTED]";

// Free-text patterns for secrets/PII that can leak through error messages,
// stack frames, or arbitrary `extra` context. Each is linear (no catastrophic
// backtracking) and applied in order.
const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  // Authorization scheme tokens — keep the scheme, drop the credential.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${REDACTED}`],
  // JWTs (incl. Supabase service-role keys): three base64url segments.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, REDACTED],
  // Common provider key/token prefixes: sk-, rk-, pk_, whsec_, ghp_, xoxb-, …
  [/\b(sk|rk|pk|whsec|ghp|gho|xox[baprs])[-_][A-Za-z0-9_-]{8,}/gi, REDACTED],
  // key=value / key: value secret assignments in query strings or bodies.
  [
    /\b(access_token|refresh_token|api[_-]?key|client_secret|signing_secret|webhook_secret|auth_token|password|secret|token)\b\s*[=:]\s*"?[^\s"&,}]+/gi,
    `$1=${REDACTED}`
  ],
  // Email addresses (PII).
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, REDACTED],
  // E.164 phone numbers (PII).
  [/\+\d{7,15}\b/g, REDACTED]
];

/** Redact secrets/PII from a free-text string (error messages, stack frames). */
export function redactSensitive(input: string): string {
  let out = input;
  for (const [re, repl] of SENSITIVE_PATTERNS) out = out.replace(re, repl);
  return out;
}

function isSensitiveKeyName(key: string): boolean {
  return /(token|secret|password|api[_-]?key|authorization|cookie|credential|private[_-]?key)/i.test(key);
}

/** Recursively redact a value: sensitive-named keys are dropped wholesale; strings are pattern-scrubbed. */
export function redactDeep(value: unknown): unknown {
  if (typeof value === "string") return redactSensitive(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKeyName(k) ? REDACTED : redactDeep(v);
    }
    return out;
  }
  return value;
}

function serializeError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { name: "UnknownError", message: String(err) };
}

/**
 * Structured error reporting — logs JSON locally; forwards to Sentry when SENTRY_DSN is set.
 */
export function reportError(err: unknown, context: ErrorContext = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level: "error",
    error: serializeError(err),
    ...context
  };

  // Scrub tokens/secrets/PII before anything leaves this process — both the
  // local log line and the Sentry forward use the redacted copy.
  const safe = redactDeep(payload) as Record<string, unknown>;

  console.error(JSON.stringify(safe));

  const dsn = process.env.SENTRY_DSN;
  if (dsn) {
    void forwardToSentry(dsn, safe).catch(() => undefined);
  }
}

async function forwardToSentry(
  dsn: string,
  payload: Record<string, unknown>
): Promise<void> {
  const match = dsn.match(/^https:\/\/([^@]+)@([^/]+)\/(\d+)$/);
  if (!match) return;

  const [, publicKey, host, projectId] = match;
  const url = `https://${host}/api/${projectId}/store/`;

  const err = payload.error as { name?: string; message?: string; stack?: string };
  const event = {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: payload.ts,
    platform: "node",
    level: "error",
    message: { formatted: err.message ?? "Unknown error" },
    exception: {
      values: [
        {
          type: err.name ?? "Error",
          value: err.message ?? "Unknown error",
          stacktrace: err.stack
            ? {
                frames: err.stack
                  .split("\n")
                  .slice(1, 8)
                  .map((line) => ({ filename: line.trim() }))
              }
            : undefined
        }
      ]
    },
    extra: payload
  };

  await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${publicKey}, sentry_client=arabclue/1.0`
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(5000)
  });
}
