/**
 * Browser calls to the voice API that keep the stable refusal `code` (apiFetch drops it), so the
 * voice page can show fixed Arabic + English text (lib/voice/messages.ts). Client-safe.
 */
export type VoiceApiResult<T> = { ok: true; data: T } | { ok: false; code: string; status: number };

export async function voiceApi<T>(url: string, init?: { method?: string; body?: unknown }): Promise<VoiceApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store"
    });
  } catch {
    return { ok: false, code: "network", status: 0 };
  }
  const json = (await res.json().catch(() => null)) as (T & { code?: unknown }) | null;
  if (res.ok && json !== null) return { ok: true, data: json };
  const code =
    json && typeof json.code === "string"
      ? json.code
      : res.status === 401
        ? "not_signed_in"
        : res.status === 402
          ? "plan_required"
          : res.status === 429
            ? "rate_limited"
            : "unknown";
  return { ok: false, code, status: res.status };
}
