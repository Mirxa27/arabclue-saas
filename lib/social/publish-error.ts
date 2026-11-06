/**
 * The one error type a connector throws. It says what the scheduler must record for the
 * platform: skipped (nothing was sent), failed (the provider refused) or unknown (the request
 * may have created the post — never retried automatically).
 */
import { ProviderHttpError, ProviderNetworkError } from "./http";
import type { PlatformResultStatus, PublishCode } from "./outcomes";

export type PublishErrorOutcome = Extract<PlatformResultStatus, "failed" | "skipped" | "unknown">;

export class PublishError extends Error {
  readonly code: PublishCode;
  readonly outcome: PublishErrorOutcome;
  readonly status?: number;
  /** The provider rejected the access token (401): a refreshable token may be refreshed once. */
  readonly unauthorized: boolean;

  constructor(
    code: PublishCode,
    message: string,
    opts: { outcome?: PublishErrorOutcome; status?: number; unauthorized?: boolean; cause?: unknown } = {}
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "PublishError";
    this.code = code;
    this.outcome = opts.outcome ?? "failed";
    this.status = opts.status;
    this.unauthorized = opts.unauthorized ?? false;
  }
}

export const skipped = (code: PublishCode, message: string) => new PublishError(code, message, { outcome: "skipped" });

/**
 * Map a provider failure to a PublishError.
 * `final` marks the request that creates the post: a transport failure there means the post
 * may exist (unknown); on a preparatory request nothing was published yet (failed).
 */
export function classifyProviderError(err: unknown, opts: { final: boolean }): PublishError {
  if (err instanceof PublishError) return err;
  if (err instanceof ProviderNetworkError) {
    return opts.final
      ? new PublishError("outcome_unknown", err.message, { outcome: "unknown", cause: err })
      : new PublishError("provider_error", err.message, { cause: err });
  }
  if (err instanceof ProviderHttpError) {
    const { status } = err;
    if (status === 401) return new PublishError("auth_failed", err.message, { status, unauthorized: true, cause: err });
    if (status === 403) return new PublishError("auth_failed", err.message, { status, cause: err });
    if (status === 429) return new PublishError("rate_limited", err.message, { status, cause: err });
    if (status >= 500) {
      // A 5xx on the creating request can still mean the post was created (timeouts behind the
      // provider's edge); treat it like a transport failure.
      return opts.final
        ? new PublishError("outcome_unknown", err.message, { outcome: "unknown", status, cause: err })
        : new PublishError("provider_error", err.message, { status, cause: err });
    }
    return new PublishError("rejected", err.message, { status, cause: err });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new PublishError("provider_error", message, { cause: err });
}
