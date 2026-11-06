"use client";

import { useCallback, useEffect, useState } from "react";
import { PageShell } from "@/components/dashboard/page-shell";
import { Card, Empty } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { VoiceStatusCard } from "@/components/dashboard/voice-status-card";
import { VoiceSettingsForm } from "@/components/dashboard/voice-settings-form";
import { VoiceRequests } from "@/components/dashboard/voice-requests";
import { VoiceCallLog } from "@/components/dashboard/voice-call-log";
import { useMerchant } from "@/hooks/use-merchant";
import { voiceApi } from "@/lib/voice/client";
import { voiceErrorMessage } from "@/lib/voice/messages";
import type { VoiceSettingsPatch } from "@/lib/voice/settings-draft";
import type {
  VoiceBookingEntry,
  VoiceBookingStatus,
  VoiceCallEntry,
  VoiceEscalationEntry,
  VoiceSettingsView
} from "@/lib/voice/types";

const bilingual = (code: string) => {
  const text = voiceErrorMessage(code);
  return `${text.ar} · ${text.en}`;
};

export default function VoicePage() {
  const { merchant, loading, error: merchantError } = useMerchant();
  const { toast } = useToast();

  const [view, setView] = useState<VoiceSettingsView | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [calls, setCalls] = useState<VoiceCallEntry[]>([]);
  const [bookings, setBookings] = useState<VoiceBookingEntry[]>([]);
  const [escalations, setEscalations] = useState<VoiceEscalationEntry[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (merchantError) toast(merchantError, "error");
  }, [merchantError, toast]);

  const load = useCallback(async () => {
    setDataLoading(true);
    const [config, callLog, bookingList, escalationList] = await Promise.all([
      voiceApi<VoiceSettingsView>("/api/voice/config"),
      voiceApi<{ calls: VoiceCallEntry[] }>("/api/voice/calls?limit=100"),
      voiceApi<{ bookings: VoiceBookingEntry[] }>("/api/voice/bookings?limit=50"),
      voiceApi<{ escalations: VoiceEscalationEntry[] }>("/api/voice/escalations?limit=50")
    ]);
    if (config.ok) {
      setView(config.data);
      setViewError(null);
    } else {
      setViewError(config.code);
    }
    if (callLog.ok) setCalls(callLog.data.calls ?? []);
    if (bookingList.ok) setBookings(bookingList.data.bookings ?? []);
    if (escalationList.ok) setEscalations(escalationList.data.escalations ?? []);
    const failed = [callLog, bookingList, escalationList].find((r) => !r.ok);
    if (failed && !failed.ok) toast(bilingual(failed.code), "error");
    setDataLoading(false);
  }, [toast]);

  useEffect(() => {
    if (!merchant) {
      setDataLoading(false);
      return;
    }
    void load();
  }, [merchant, load]);

  async function toggleAgent(next: boolean) {
    setToggling(true);
    const res = await voiceApi<VoiceSettingsView & { ok: true }>("/api/voice/config", { method: "PATCH", body: { enabled: next } });
    setToggling(false);
    if (!res.ok) {
      toast(bilingual(res.code), "error");
      return;
    }
    setView(res.data);
    toast(next ? "تم تشغيل المساعد · Agent switched on" : "تم إيقاف المساعد · Agent paused", "success");
  }

  async function provision(replace: boolean) {
    setProvisioning(true);
    const res = await voiceApi<{ ok: true; phoneNumber: string }>("/api/voice/provision-number", {
      method: "POST",
      body: replace ? { replace: true } : {}
    });
    setProvisioning(false);
    if (!res.ok) {
      toast(bilingual(res.code), "error");
      await load();
      return;
    }
    toast(`رقم متجرك: ${res.data.phoneNumber} · Your store number: ${res.data.phoneNumber}`, "success");
    await load();
  }

  async function saveSettings(patch: VoiceSettingsPatch) {
    setSaving(true);
    const res = await voiceApi<VoiceSettingsView & { ok: true }>("/api/voice/config", { method: "PATCH", body: patch });
    setSaving(false);
    if (!res.ok) {
      toast(bilingual(res.code), "error");
      return;
    }
    setView(res.data);
    toast("تم حفظ الإعدادات · Settings saved", "success");
  }

  async function setBookingStatus(id: string, status: VoiceBookingStatus) {
    setBusyId(id);
    const res = await voiceApi<{ booking: VoiceBookingEntry }>("/api/voice/bookings", { method: "PATCH", body: { id, status } });
    setBusyId(null);
    if (!res.ok) {
      toast(bilingual(res.code), "error");
      return;
    }
    setBookings((list) => list.map((b) => (b.id === id ? res.data.booking : b)));
  }

  async function setEscalationStatus(id: string, status: "open" | "resolved") {
    setBusyId(id);
    const res = await voiceApi<{ escalation: VoiceEscalationEntry }>("/api/voice/escalations", { method: "PATCH", body: { id, status } });
    setBusyId(null);
    if (!res.ok) {
      toast(bilingual(res.code), "error");
      return;
    }
    setEscalations((list) => list.map((e) => (e.id === id ? res.data.escalation : e)));
  }

  const settingsLocked = !view || !view.availability.entitled || !view.availability.platformEnabled;

  return (
    <PageShell title="المساعد الصوتي · Voice agent" merchant={merchant} loading={loading || dataLoading}>
      <div className="space-y-6">
        {view ? (
          <>
            <VoiceStatusCard
              view={view}
              toggling={toggling}
              provisioning={provisioning}
              onToggle={toggleAgent}
              onProvision={provision}
            />
            <VoiceSettingsForm
              settings={view.config}
              availability={view.availability}
              limits={view.limits}
              disabled={settingsLocked}
              saving={saving}
              onSave={saveSettings}
            />
          </>
        ) : (
          <Card>
            <Empty
              title="تعذّر تحميل إعدادات المساعد · Couldn't load the voice settings"
              hint={viewError ? bilingual(viewError) : undefined}
              action={
                <Button variant="ghost" onClick={() => void load()}>
                  إعادة المحاولة · Retry
                </Button>
              }
            />
          </Card>
        )}

        <VoiceRequests
          bookings={bookings}
          escalations={escalations}
          busyId={busyId}
          onBookingStatus={setBookingStatus}
          onEscalationStatus={setEscalationStatus}
        />

        <VoiceCallLog calls={calls} />
      </div>
    </PageShell>
  );
}
