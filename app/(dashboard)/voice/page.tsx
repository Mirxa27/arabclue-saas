"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/dashboard/page-shell";
import { Badge, Card, CardHeader, CardSubtitle, CardTitle, Empty, Field, Input, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { getBrowserSupabase } from "@/lib/db/supabase-browser";
import { useMerchant } from "@/hooks/use-merchant";
import type { Booking, VoiceConfig } from "@/lib/types/database";
import { Phone, Save } from "lucide-react";

const defaultConfig: Omit<VoiceConfig, "merchant_id" | "updated_at"> = {
  dialect: "khaliji",
  hours: "",
  escalation_phone: "",
  knowledge: "",
  phone_number: null,
  enabled: false
};

export default function VoicePage() {
  const { merchant, loading, error: merchantError } = useMerchant();
  const { toast } = useToast();
  const [config, setConfig] = useState(defaultConfig);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (merchantError) toast(merchantError, "error");
  }, [merchantError, toast]);

  useEffect(() => {
    if (!merchant) {
      setDataLoading(false);
      return;
    }
    (async () => {
      setDataLoading(true);
      try {
        const sb = getBrowserSupabase();
        const [{ data: vc, error: vcErr }, { data: bk, error: bkErr }] = await Promise.all([
          sb.from("voice_configs").select("*").eq("merchant_id", merchant.id).maybeSingle(),
          sb.from("bookings").select("*").eq("merchant_id", merchant.id).order("created_at", { ascending: false }).limit(20)
        ]);
        if (vcErr) throw vcErr;
        if (bkErr) throw bkErr;
        if (vc) {
          setConfig({
            dialect: vc.dialect ?? "khaliji",
            hours: vc.hours ?? "",
            escalation_phone: vc.escalation_phone ?? "",
            knowledge: vc.knowledge ?? "",
            phone_number: vc.phone_number,
            enabled: vc.enabled ?? false
          });
        }
        setBookings((bk ?? []) as Booking[]);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Failed to load voice config", "error");
      } finally {
        setDataLoading(false);
      }
    })();
  }, [merchant, toast]);

  async function save() {
    setSaving(true);
    try {
      await apiFetch("/api/voice/config", {
        method: "POST",
        body: JSON.stringify(config)
      });
      toast("Voice config saved", "success");
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell title="Voice Agent" merchant={merchant} loading={loading || dataLoading}>
      <div className="p-8 space-y-6 overflow-y-auto">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Gulf-dialect phone agent</CardTitle>
              <CardSubtitle>Answers your store line 24/7 in Saudi Arabic. Order status, bookings, FAQs, clean escalation.</CardSubtitle>
            </div>
            <Badge tone={config.enabled ? "success" : "default"}>{config.enabled ? "Live" : "Off"}</Badge>
          </CardHeader>

          <div className="grid md:grid-cols-2 gap-5 mt-2">
            <Field label="Dialect">
              <select
                className="w-full border border-rule bg-paper px-3 py-2.5 text-sm focus:outline-none focus:border-ink/50"
                value={config.dialect}
                onChange={(e) => setConfig({ ...config, dialect: e.target.value as VoiceConfig["dialect"] })}
              >
                <option value="khaliji">Khaliji (Saudi)</option>
                <option value="msa">Modern Standard Arabic</option>
              </select>
            </Field>
            <Field label="Escalation phone" hint="Where calls hand off to a human">
              <Input value={config.escalation_phone ?? ""} onChange={(e) => setConfig({ ...config, escalation_phone: e.target.value })} placeholder="+9665XXXXXXXX" />
            </Field>
            <Field label="Business hours">
              <Input value={config.hours ?? ""} onChange={(e) => setConfig({ ...config, hours: e.target.value })} placeholder="٩ صباحاً – ١١ مساءً" />
            </Field>
            <Field label="Store number" hint="Provisioned STC / Twilio line">
              <Input value={config.phone_number ?? ""} disabled placeholder="provisioned after setup" />
            </Field>
            <div className="md:col-span-2">
              <Field label="Knowledge" hint="Return policy, delivery areas, anything the agent should know">
                <Textarea rows={4} value={config.knowledge ?? ""} onChange={(e) => setConfig({ ...config, knowledge: e.target.value })} />
              </Field>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <Button onClick={save} disabled={saving}>
              <Save size={14} /> {saving ? "Saving…" : "Save config"}
            </Button>
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input type="checkbox" checked={config.enabled} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} />
              Enable on store line
            </label>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent bookings</CardTitle>
              <CardSubtitle>Captured by the voice agent.</CardSubtitle>
            </div>
            <Phone size={18} className="text-ink-mute" />
          </CardHeader>
          {bookings.length === 0 ? (
            <Empty title="No bookings yet" hint="Bookings created by the voice agent will appear here." />
          ) : (
            <ul className="divide-y divide-rule">
              {bookings.map((b) => (
                <li key={b.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {b.name} · <span className="font-mono text-sm text-ink-mute">{b.mobile}</span>
                    </p>
                    <p className="text-sm text-ink-soft">
                      {b.preferred_time}
                      {b.note ? ` — ${b.note}` : ""}
                    </p>
                  </div>
                  <Badge tone={b.status === "confirmed" ? "success" : "default"}>{b.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
