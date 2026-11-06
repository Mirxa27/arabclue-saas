/**
 * Typed HTTP failure for API route handlers and the lib/ code they call.
 * `handleRouteError` maps it to `{ error: message }` with `status`.
 */
export class HttpError extends Error {
  readonly status: number;
  /** Stable machine-readable code for clients (optional). */
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`, "not_found");
