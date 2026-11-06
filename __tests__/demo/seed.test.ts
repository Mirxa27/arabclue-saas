import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  seedDemoMerchant,
  buildDemoMerchant,
  buildDemoBrandKit,
  demoSeedOptionsFromEnv,
  generateDemoPassword,
  DEMO_EMAIL
} from "@/lib/demo/seed";

type UpsertRecord = { table: string; row: Record<string, unknown>; onConflict?: string };
type FakeUser = { id: string; email: string };

/** A paginating fake of auth.admin (page/perPage like GoTrue) plus upsert recording. */
function fakeClient(opts: { users?: FakeUser[]; createdId?: string; upsertError?: string } = {}) {
  const users = opts.users ?? [];
  const upserts: UpsertRecord[] = [];
  const createUser = vi.fn(async (_args: { email: string; password: string; email_confirm: boolean }) => ({
    data: { user: { id: opts.createdId ?? "new-user-id" } },
    error: null
  }));
  const updateUserById = vi.fn(async (_id: string, _attrs: { password: string }) => ({ data: { user: {} }, error: null }));
  const listUsers = vi.fn(async (params?: { page?: number; perPage?: number }) => {
    const page = params?.page ?? 1;
    const perPage = params?.perPage ?? 50;
    return { data: { users: users.slice((page - 1) * perPage, page * perPage) }, error: null };
  });
  const client = {
    auth: { admin: { listUsers, createUser, updateUserById } },
    from(table: string) {
      return {
        upsert: (row: Record<string, unknown>, options?: { onConflict?: string }) => {
          upserts.push({ table, row, onConflict: options?.onConflict });
          return Promise.resolve({ error: opts.upsertError && table === "merchants" ? { message: opts.upsertError } : null });
        }
      };
    }
  } as unknown as SupabaseClient;
  return { client, upserts, createUser, updateUserById, listUsers };
}

const NOW = new Date("2026-11-06T10:00:00.000Z");

describe("seedDemoMerchant", () => {
  it("creates the demo user with a generated password, owned merchant and brand kit", async () => {
    const { client, upserts, createUser } = fakeClient({ createdId: "u-123" });
    const r = await seedDemoMerchant(client, { now: NOW });

    expect(createUser).toHaveBeenCalledOnce();
    const args = createUser.mock.calls[0][0];
    expect(args.email).toBe(DEMO_EMAIL);
    expect(args.email_confirm).toBe(true);
    // Never a password from the repository: a fresh random one, returned once.
    expect(args.password).toBe(r.generatedPassword);
    expect(args.password).not.toBe("arabclue-demo-2026!");
    expect(args.password.length).toBeGreaterThanOrEqual(32);

    expect(r).toMatchObject({ userId: "u-123", merchantId: "u-123", created: true, passwordUpdated: false });
    const merchant = upserts.find((u) => u.table === "merchants");
    expect(merchant?.row).toMatchObject({
      id: "u-123",
      owner_user_id: "u-123",
      plan: "pro",
      subscription_status: "active",
      subscription_expires_at: "2026-12-06T10:00:00.000Z"
    });
    expect(merchant?.onConflict).toBe("id");
    expect(r.subscriptionExpiresAt).toBe("2026-12-06T10:00:00.000Z");

    const brand = upserts.find((u) => u.table === "brand_kits");
    expect(brand?.row.merchant_id).toBe("u-123");
    expect(brand?.onConflict).toBe("merchant_id");
  });

  it("uses an explicit password for a new user and does not echo it back", async () => {
    const { client, createUser } = fakeClient({ createdId: "u-9" });
    const r = await seedDemoMerchant(client, { password: "a-long-operator-secret", now: NOW });
    expect(createUser.mock.calls[0][0].password).toBe("a-long-operator-secret");
    expect(r.generatedPassword).toBeUndefined();
  });

  it("is idempotent — reuses an existing demo user and leaves its password alone", async () => {
    const { client, createUser, updateUserById } = fakeClient({ users: [{ id: "u-existing", email: DEMO_EMAIL }] });
    const r = await seedDemoMerchant(client, { now: NOW });
    expect(createUser).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
    expect(r).toMatchObject({ userId: "u-existing", merchantId: "u-existing", created: false, passwordUpdated: false });
    expect(r.generatedPassword).toBeUndefined();
  });

  it("replaces an existing user's password only when one is given", async () => {
    const { client, updateUserById } = fakeClient({ users: [{ id: "u-existing", email: DEMO_EMAIL.toUpperCase() }] });
    const r = await seedDemoMerchant(client, { password: "another-long-secret", now: NOW });
    expect(updateUserById).toHaveBeenCalledWith("u-existing", { password: "another-long-secret" });
    expect(r.passwordUpdated).toBe(true);
  });

  it("finds the demo user beyond the first page of users", async () => {
    const filler = Array.from({ length: 2345 }, (_, i) => ({ id: `u-${i}`, email: `user${i}@example.com` }));
    const { client, createUser, listUsers } = fakeClient({ users: [...filler, { id: "u-demo", email: DEMO_EMAIL }] });
    const r = await seedDemoMerchant(client, { now: NOW });
    expect(createUser).not.toHaveBeenCalled();
    expect(r.userId).toBe("u-demo");
    expect(listUsers).toHaveBeenCalledTimes(3);
    expect(listUsers.mock.calls.map((c) => c[0])).toEqual([
      { page: 1, perPage: 1000 },
      { page: 2, perPage: 1000 },
      { page: 3, perPage: 1000 }
    ]);
  });

  it("refuses a short password and an invalid subscription length before touching auth", async () => {
    const { client, createUser, listUsers } = fakeClient();
    await expect(seedDemoMerchant(client, { password: "short" })).rejects.toThrow(/at least 12 characters/);
    await expect(seedDemoMerchant(client, { days: 0 })).rejects.toThrow(/DEMO_MERCHANT_DAYS/);
    await expect(seedDemoMerchant(client, { days: 1.5 })).rejects.toThrow(/DEMO_MERCHANT_DAYS/);
    await expect(seedDemoMerchant(client, { email: "not-an-email" })).rejects.toThrow(/valid email/);
    expect(listUsers).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });

  it("surfaces a merchant upsert failure", async () => {
    const { client } = fakeClient({ upsertError: "boom" });
    await expect(seedDemoMerchant(client, { now: NOW })).rejects.toThrow(/demo merchant: boom/);
  });
});

describe("demoSeedOptionsFromEnv", () => {
  it("reads email, password and days; blank values are unset", () => {
    expect(
      demoSeedOptionsFromEnv({ DEMO_MERCHANT_EMAIL: " Reviewer@Example.com ", DEMO_MERCHANT_PASSWORD: "x".repeat(16), DEMO_MERCHANT_DAYS: "14" })
    ).toEqual({ email: "Reviewer@Example.com", password: "x".repeat(16), days: 14 });
    expect(demoSeedOptionsFromEnv({ DEMO_MERCHANT_EMAIL: "", DEMO_MERCHANT_PASSWORD: "", DEMO_MERCHANT_DAYS: " " })).toEqual({
      email: undefined,
      password: undefined,
      days: undefined
    });
  });
});

describe("demo data builders match the migration schema", () => {
  it("merchant row uses only real merchants columns and ties the row to its owner", () => {
    const row = buildDemoMerchant("id-1", { now: NOW, days: 7 });
    expect(Object.keys(row).sort()).toEqual(
      [
        "cr_number",
        "id",
        "installed_at",
        "owner_user_id",
        "plan",
        "salla_merchant_id",
        "seller_name",
        "store_url",
        "subscription_expires_at",
        "subscription_status",
        "vat_number"
      ].sort()
    );
    expect(row.owner_user_id).toBe("id-1");
    expect(row.subscription_expires_at).toBe("2026-11-13T10:00:00.000Z");
  });
  it("brand kit is scoped to the merchant with a valid dialect", () => {
    const b = buildDemoBrandKit("id-1");
    expect(b.merchant_id).toBe("id-1");
    expect(b.dialect).toBe("khaliji");
    expect(b.attributes.length).toBeGreaterThan(0);
  });
  it("generated passwords are long and distinct", () => {
    const a = generateDemoPassword();
    const b = generateDemoPassword();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});
