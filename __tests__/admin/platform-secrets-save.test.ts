import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const maybeSingle = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/supabase", () => ({
  getServiceSupabase: () => ({
    rpc,
    from: () => {
      const query = { maybeSingle, abortSignal: () => query };
      return { select: () => ({ eq: () => query }) };
    }
  })
}));
vi.mock("@/lib/crypto/secrets", () => ({ encryptSecret: (v: string) => `enc(${v})`, decryptSecret: (v: string) => v }));

import { savePlatformSecrets, loadDecryptedSecretsResult } from "@/lib/admin/platform-secrets";
import { isBootstrapSecretKey, MANAGED_SECRET_KEYS } from "@/lib/admin/secret-registry";

const [KEY_A, KEY_B] = MANAGED_SECRET_KEYS.filter((k) => !isBootstrapSecretKey(k));

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
  maybeSingle.mockReset();
});

describe("savePlatformSecrets (atomic merge, #33)", () => {
  it("sends only the changed keys to merge_platform_secrets — no read-modify-write of the blob", async () => {
    const result = await savePlatformSecrets({ [KEY_A]: " new ", [KEY_B]: null });
    expect(result.updated.sort()).toEqual([KEY_A, KEY_B].sort());
    expect(maybeSingle).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("merge_platform_secrets", { p_set: { [KEY_A]: "enc(new)" }, p_remove: [KEY_B] });
  });

  it("skips unmanaged and bootstrap keys and does nothing when no managed key changed", async () => {
    const result = await savePlatformSecrets({ NOT_A_KEY: "x", SUPABASE_SERVICE_ROLE_KEY: "y" });
    expect(result).toEqual({ updated: [], skipped: ["NOT_A_KEY", "SUPABASE_SERVICE_ROLE_KEY"] });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces a failed write instead of reporting success", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "08006", message: "connection failed" } });
    await expect(savePlatformSecrets({ [KEY_A]: "new" })).rejects.toThrow(/connection failed/);
  });

  it("explains a missing migration", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    await expect(savePlatformSecrets({ [KEY_A]: "new" })).rejects.toThrow(/merge_platform_secrets\(\) missing/);
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
