"use client";

import { useCallback, useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/db/supabase-browser";
import type { Merchant } from "@/lib/types/database";

type UseMerchantResult = {
  merchant: Merchant | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

export function useMerchant(): UseMerchantResult {
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sb = getBrowserSupabase();
      const { data: { user }, error: authErr } = await sb.auth.getUser();
      if (authErr) throw authErr;
      if (!user) {
        setMerchant(null);
        return;
      }
      const { data, error: merchantErr } = await sb
        .from("merchants")
        .select("*")
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

  return { merchant, loading, error, reload };
}
