import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seedDemoMerchant, buildDemoMerchant, buildDemoBrandKit, DEMO_EMAIL } from "@/lib/demo/seed";

type UpsertRecord = { table: string; row: Record<string, unknown>; onConflict?: string };

function fakeClient(opts: { existingUser?: { id: string; email: string }; createdId?: string }) {
  const upserts: UpsertRecord[] = [];
  const createUser = vi.fn(async () => ({ data: { user: { id: opts.createdId ?? "new-user-id" } }, error: null }));
  const listUsers = vi.fn(async () => ({
    data: { users: opts.existingUser ? [opts.existingUser] : [] },
    error: null
  }));
  const client = {
    auth: { admin: { listUsers, createUser } },
    from(table: string) {
      return {
        upsert: (row: Record<string, unknown>, options?: { onConflict?: string }) => {
          upserts.push({ table, row, onConflict: options?.onConflict });
          return Promise.resolve({ error: null });
        }
      };
    }
  } as unknown as SupabaseClient;
  return { client, upserts, createUser, listUsers };
}

describe("seedDemoMerchant", () => {
  it("creates a demo user and upserts merchant + brand kit keyed by the user id", async () => {
    const { client, upserts, createUser } = fakeClient({ createdId: "u-123" });
    const r = await seedDemoMerchant(client);

    expect(createUser).toHaveBeenCalledOnce();
    expect(r).toEqual({ userId: "u-123", merchantId: "u-123", created: true });

    const merchant = upserts.find((u) => u.table === "merchants");
    expect(merchant?.row.id).toBe("u-123");
    expect(merchant?.onConflict).toBe("id");

    const brand = upserts.find((u) => u.table === "brand_kits");
    expect(brand?.row.merchant_id).toBe("u-123");
    expect(brand?.onConflict).toBe("merchant_id");
  });

  it("is idempotent — reuses an existing demo user instead of creating one", async () => {
    const { client, createUser } = fakeClient({ existingUser: { id: "u-existing", email: DEMO_EMAIL } });
    const r = await seedDemoMerchant(client);
    expect(createUser).not.toHaveBeenCalled();
    expect(r).toEqual({ userId: "u-existing", merchantId: "u-existing", created: false });
  });

  it("surfaces a merchant upsert failure", async () => {
    const client = {
      auth: {
        admin: {
          listUsers: async () => ({ data: { users: [] }, error: null }),
          createUser: async () => ({ data: { user: { id: "x" } }, error: null })
        }
      },
      from: (table: string) => ({
        upsert: async () => ({ error: table === "merchants" ? { message: "boom" } : null })
      })
    } as unknown as SupabaseClient;
    await expect(seedDemoMerchant(client)).rejects.toThrow(/demo merchant: boom/);
  });
});

describe("demo data builders match the migration schema", () => {
  it("merchant row uses only columns from 0001_init", () => {
    expect(Object.keys(buildDemoMerchant("id-1")).sort()).toEqual(
      ["cr_number", "id", "installed_at", "plan", "salla_merchant_id", "seller_name", "store_url", "vat_number"].sort()
    );
  });
  it("brand kit is scoped to the merchant with a valid dialect", () => {
    const b = buildDemoBrandKit("id-1");
    expect(b.merchant_id).toBe("id-1");
    expect(b.dialect).toBe("khaliji");
    expect(b.attributes.length).toBeGreaterThan(0);
  });
});
