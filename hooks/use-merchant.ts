"use client";

import { useCallback, useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/db/supabase-browser";
import { MERCHANT_CLIENT_COLUMNS } from "@/lib/merchant/columns";
import type { Merchant } from "@/lib/types/database";

type UseMerchantResult = {
  merchant: Merchant | null;
  /** The signed-in user's email (the auth user — merchants has no email column). */
  email: string | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

export function useMerchant(): UseMerchantResult {
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sb = getBrowserSupabase();
      const { data: { user }, error: authErr } = await sb.auth.getUser();
      if (authErr) throw authErr;
      setEmail(user?.email ?? null);
      if (!user) {
        setMerchant(null);
        return;
      }
      // Browser code: the secret-free client columns only (authenticated cannot read the Salla
      // tokens or the ZATCA CSID; `select("*")` is refused with 42501).
      const { data, error: merchantErr } = await sb
        .from("merchants")
        .select(MERCHANT_CLIENT_COLUMNS)
        .eq("owner_user_id", user.id)
        .maybeSingle();
      if (merchantErr) throw merchantErr;
      setMerchant(data as Merchant | null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load merchant";
      setError(message);
      setMerchant(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { merchant, email, loading, error, reload };
}
