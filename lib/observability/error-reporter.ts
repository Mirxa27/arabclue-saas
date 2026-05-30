type ErrorContext = {
  route?: string;
  userId?: string;
  merchantId?: string;
  status?: number;
  extra?: Record<string, unknown>;
};

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

  console.error(JSON.stringify(payload));

  const dsn = process.env.SENTRY_DSN;
  if (dsn) {
    void forwardToSentry(dsn, payload).catch(() => undefined);
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
