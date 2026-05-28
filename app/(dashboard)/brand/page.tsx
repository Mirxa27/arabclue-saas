"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/dashboard/page-shell";
import { Card, CardHeader, CardSubtitle, CardTitle, Field, Input, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { getBrowserSupabase } from "@/lib/db/supabase-browser";
import { useMerchant } from "@/hooks/use-merchant";
import type { BrandKit } from "@/lib/types/database";

const empty: BrandKit = {
  brand_name: "",
  essence: "",
  attributes: [],
  favor_words: [],
  avoid_words: [],
  dialect: "khaliji"
};

export default function BrandPage() {
  const { merchant, loading, error: merchantError } = useMerchant();
  const { toast } = useToast();
  const [kit, setKit] = useState<BrandKit>(empty);
  const [kitLoading, setKitLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (merchantError) toast(merchantError, "error");
  }, [merchantError, toast]);

  useEffect(() => {
    if (!merchant) {
      setKitLoading(false);
      return;
    }
    (async () => {
      setKitLoading(true);
      try {
        const sb = getBrowserSupabase();
        const { data, error } = await sb.from("brand_kits").select("*").eq("merchant_id", merchant.id).maybeSingle();
        if (error) throw error;
        if (data) setKit({ ...empty, ...data });
      } catch (err) {
        toast(err instanceof Error ? err.message : "Failed to load brand kit", "error");
      } finally {
        setKitLoading(false);
      }
    })();
  }, [merchant, toast]);

  async function save() {
    setSaving(true);
    try {
      await apiFetch("/api/brand-kit", {
        method: "POST",
        body: JSON.stringify(kit)
      });
      toast("Brand kit saved", "success");
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell title="Brand Kit" merchant={merchant} loading={loading || kitLoading}>
      <div className="p-8 max-w-3xl space-y-6 overflow-y-auto">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Voice</CardTitle>
              <CardSubtitle>The social agent uses this to write captions, reply to DMs, and choose what to post when.</CardSubtitle>
            </div>
          </CardHeader>

          <div className="space-y-6">
            <Field label="Brand name">
              <Input value={kit.brand_name} onChange={(e) => setKit({ ...kit, brand_name: e.target.value })} placeholder="e.g., Bayt Al-Oud" />
            </Field>

            <Field label="Essence" hint="One line describing what you sell and to whom.">
              <Textarea
                rows={2}
                value={kit.essence ?? ""}
                onChange={(e) => setKit({ ...kit, essence: e.target.value })}
                placeholder="Premium oud and bakhoor for Saudi households who appreciate tradition."
              />
            </Field>

            <Field label="Voice attributes" hint="3–7 traits, comma-separated. e.g., confident, warm, rooted-in-tradition">
              <Input
                value={kit.attributes.join(", ")}
                onChange={(e) => setKit({ ...kit, attributes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              />
            </Field>

            <Field label="Dialect">
              <select
                className="w-full bg-paper border border-ink/15 px-3 py-2.5 text-sm focus:outline-none focus:border-ink/50"
                value={kit.dialect}
                onChange={(e) => setKit({ ...kit, dialect: e.target.value as BrandKit["dialect"] })}
              >
                <option value="khaliji">Khaliji (Saudi Arabic)</option>
                <option value="msa">MSA (Fusha)</option>
                <option value="english">English</option>
              </select>
            </Field>

            <Field label="Favor words" hint="Words your brand uses (comma-separated)">
              <Input
                value={kit.favor_words.join(", ")}
                onChange={(e) => setKit({ ...kit, favor_words: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              />
            </Field>

            <Field label="Avoid words" hint="Words off-brand or off-limits (comma-separated)">
              <Input
                value={kit.avoid_words.join(", ")}
                onChange={(e) => setKit({ ...kit, avoid_words: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              />
            </Field>

            <div className="flex items-center gap-3 pt-2">
              <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save brand kit"}</Button>
            </div>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
