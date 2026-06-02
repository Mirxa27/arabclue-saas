import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Service client whose query never settles — exercises the boot-time timeout guard
// in loadDecryptedSecrets (the path instrumentation.ts awaits on server start).
vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          abortSignal: () => ({
            maybeSingle: () => new Promise(() => {}),
          }),
        }),
      }),
    }),
  }),
}));

import { loadDecryptedSecrets } from "@/lib/admin/platform-secrets";

describe("platform secrets boot timeout", () => {
  const prev = process.env.PLATFORM_SECRETS_TIMEOUT_MS;

  beforeEach(() => {
    process.env.PLATFORM_SECRETS_TIMEOUT_MS = "50";
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.PLATFORM_SECRETS_TIMEOUT_MS;
    else process.env.PLATFORM_SECRETS_TIMEOUT_MS = prev;
  });

  it("resolves to an empty set instead of hanging when the database never responds", async () => {
    const started = Date.now();
    const secrets = await loadDecryptedSecrets();
    const elapsed = Date.now() - started;

    expect(secrets).toEqual({});
    // Bounded by the 50ms guard. Without the timeout this read would hang until
    // vitest's 5s test timeout fired — that regression is what this asserts against.
    expect(elapsed).toBeLessThan(2000);
  });
});
