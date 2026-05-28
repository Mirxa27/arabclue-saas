import { z } from "zod";

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

const ErrorBodySchema = z.object({
  error: z.string().optional(),
  message: z.string().optional()
});

export async function apiFetch<T>(
  url: string,
  init?: RequestInit & { parse?: z.ZodType<T> }
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network request failed";
    throw new ApiClientError(message, 0, "network");
  }

  const text = await res.text();
  let json: unknown = {};
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      if (!res.ok) throw new ApiClientError(text || res.statusText, res.status);
      return undefined as T;
    }
  }

  if (!res.ok) {
    const parsed = ErrorBodySchema.safeParse(json);
    const message = parsed.success
      ? parsed.data.error ?? parsed.data.message ?? res.statusText
      : res.statusText;
    throw new ApiClientError(message, res.status);
  }

  if (init?.parse) return init.parse.parse(json);
  return json as T;
}
