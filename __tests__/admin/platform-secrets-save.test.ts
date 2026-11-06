import { describe, expect, it, vi } from "vitest";

const upsert = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const maybeSingle = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => ({
    from: () => {
      const query = { maybeSingle, abortSignal: () => query };
      return { select: () => ({ eq: () => query }), upsert };
    }
  })
}));
vi.mock("@/lib/crypto/secrets", () => ({ encryptSecret: (v: string) => `enc(${v})`, decryptSecret: (v: string) => v }));

import { savePlatformSecrets, loadDecryptedSecretsResult } from "@/lib/admin/platform-secrets";
import { isBootstrapSecretKey, MANAGED_SECRET_KEYS } from "@/lib/admin/secret-registry";

const [KEY_A, KEY_B] = MANAGED_SECRET_KEYS.filter((k) => !isBootstrapSecretKey(k));

describe("savePlatformSecrets", () => {
  it("aborts instead of wiping the stored secrets when the current blob cannot be read", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: { code: "08006", message: "connection failed" } });
    await expect(savePlatformSecrets({ [KEY_A]: "new" })).rejects.toThrow(/connection failed/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("merges the update into the existing blob", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { value: { [KEY_B]: "enc(kept)" } }, error: null });
    await savePlatformSecrets({ [KEY_A]: "new" });
    const row = (upsert.mock.calls.at(-1) as unknown as [{ value: Record<string, string> }])[0];
    expect(row.value).toEqual({ [KEY_B]: "enc(kept)", [KEY_A]: "enc(new)" });
  });
});

describe("loadDecryptedSecretsResult", () => {
  it("distinguishes a failed read from an empty store", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: { code: "08006", message: "down" } });
    expect(await loadDecryptedSecretsResult()).toMatchObject({ ok: false, reason: "error" });
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await loadDecryptedSecretsResult()).toEqual({ ok: true, secrets: {} });
  });
});
