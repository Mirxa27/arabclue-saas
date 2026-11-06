import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isBootstrapSecretKey, MANAGED_SECRET_KEYS } from "@/lib/admin/secret-registry";

const load = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/platform-secrets", () => ({ loadDecryptedSecretsResult: load }));

import { hydratePlatformEnvFromDatabase, resetPlatformEnvBootSnapshot } from "@/lib/platform/env";

const [KEY_A, KEY_B] = MANAGED_SECRET_KEYS.filter((k) => !isBootstrapSecretKey(k));

describe("hydratePlatformEnvFromDatabase (F33)", () => {
  const saved = { a: process.env[KEY_A], b: process.env[KEY_B] };

  beforeEach(() => {
    resetPlatformEnvBootSnapshot();
    load.mockReset();
    process.env[KEY_A] = "from-hpanel";
    delete process.env[KEY_B];
  });

  afterEach(() => {
    for (const [k, v] of [[KEY_A, saved.a], [KEY_B, saved.b]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("applies stored secrets over the boot value", async () => {
    load.mockResolvedValue({ ok: true, secrets: { [KEY_A]: "stored-a", [KEY_B]: "stored-b" } });
    await hydratePlatformEnvFromDatabase();
    expect(process.env[KEY_A]).toBe("stored-a");
    expect(process.env[KEY_B]).toBe("stored-b");
  });

  it("clearing a stored secret restores the hPanel value, or unsets the key when there was none", async () => {
    load.mockResolvedValueOnce({ ok: true, secrets: { [KEY_A]: "stored-a", [KEY_B]: "stored-b" } });
    await hydratePlatformEnvFromDatabase();
    load.mockResolvedValueOnce({ ok: true, secrets: {} });
    await hydratePlatformEnvFromDatabase();
    expect(process.env[KEY_A]).toBe("from-hpanel");
    expect(KEY_B in process.env).toBe(false);
  });

  it("keeps current values when the database read fails or times out", async () => {
    load.mockResolvedValueOnce({ ok: true, secrets: { [KEY_B]: "stored-b" } });
    await hydratePlatformEnvFromDatabase();
    load.mockResolvedValueOnce({ ok: false, secrets: {}, reason: "timeout" });
    await hydratePlatformEnvFromDatabase();
    expect(process.env[KEY_B]).toBe("stored-b");
    expect(process.env[KEY_A]).toBe("from-hpanel");
  });
});
