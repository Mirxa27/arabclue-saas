"use client";

import { format, parseISO } from "date-fns";
import { CalendarClock, CheckCircle2, LifeBuoy, RotateCcw } from "lucide-react";
import { Badge, Card, CardSubtitle, CardTitle, Empty } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import type { VoiceBookingEntry, VoiceBookingStatus, VoiceEscalationEntry } from "@/lib/voice/types";

const BOOKING_STATUS_TEXT: Record<VoiceBookingStatus, { ar: string; en: string }> = {
  new: { ar: "جديد", en: "New" },
  confirmed: { ar: "مؤكَّد", en: "Confirmed" },
  done: { ar: "تم", en: "Done" },
  canceled: { ar: "ملغى", en: "Canceled" }
};

const BOOKING_TONE: Record<VoiceBookingStatus, "warn" | "success" | "default" | "danger"> = {
  new: "warn",
  confirmed: "success",
  done: "default",
  canceled: "danger"
};

const when = (iso: string) => format(parseISO(iso), "yyyy-MM-dd HH:mm");

/**
 * What callers asked the store for (SW-24): hand-overs to follow up and booking requests to
 * confirm. Caller- and AI-authored text renders with dir="auto".
 */
export function VoiceRequests({
  bookings,
  escalations,
  busyId,
  onBookingStatus,
  onEscalationStatus
}: {
  bookings: VoiceBookingEntry[];
  escalations: VoiceEscalationEntry[];
  busyId: string | null;
  onBookingStatus: (id: string, status: VoiceBookingStatus) => void;
  onEscalationStatus: (id: string, status: "open" | "resolved") => void;
}) {
  const open = escalations.filter((e) => e.status === "open");

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="p-0 overflow-hidden">
        <div className="p-5">
          <CardTitle className="flex items-center gap-2 font-arabic text-lg md:text-xl">
            <LifeBuoy size={18} className="text-accent-warm" aria-hidden />
            متابعات مطلوبة · Follow-ups
          </CardTitle>
          <CardSubtitle className="mt-1">
            <span className="font-arabic">{`${open.length} طلب بانتظار تواصل فريقك.`}</span>{" "}
            {`${open.length} waiting for your team to get back to the caller.`}
          </CardSubtitle>
        </div>
        {escalations.length === 0 ? (
          <div className="border-t border-rule/30 p-6">
            <Empty title="لا توجد متابعات · Nothing to follow up" hint="عندما يطلب متصل التحدث مع الفريق يظهر طلبه هنا. · When a caller asks for your team, it shows up here." />
          </div>
        ) : (
          <ul className="divide-y divide-rule/30 border-t border-rule/30">
            {escalations.map((e) => (
              <li key={e.id} className="space-y-2 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <p dir="auto" className="font-arabic text-sm font-medium text-ink">
                    {e.reason}
                  </p>
                  <Badge tone={e.status === "open" ? "warn" : "default"}>{e.status === "open" ? "مفتوح · Open" : "تمت · Resolved"}</Badge>
                </div>
                {e.summary && (
                  <p dir="auto" className="font-arabic text-xs leading-relaxed text-ink-soft">
                    {e.summary}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-mute">
                  <span>
                    {e.callback_number ? (
                      <>
                        اتصل على · Call back:{" "}
                        <a dir="ltr" href={`tel:${e.callback_number}`} className="font-mono text-accent hover:underline">
                          {e.callback_number}
                        </a>
                      </>
                    ) : (
                      "لا يوجد رقم للمعاودة · No callback number"
                    )}
                    <span dir="ltr" className="ms-2 font-mono">
                      {when(e.created_at)}
                    </span>
                  </span>
                  {e.status === "open" ? (
                    <Button size="sm" variant="ghost" disabled={busyId === e.id} onClick={() => onEscalationStatus(e.id, "resolved")}>
                      <CheckCircle2 size={13} aria-hidden />
                      تمت المتابعة · Mark done
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={busyId === e.id} onClick={() => onEscalationStatus(e.id, "open")}>
                      <RotateCcw size={13} aria-hidden />
                      إعادة فتح · Reopen
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="p-5">
          <CardTitle className="flex items-center gap-2 font-arabic text-lg md:text-xl">
            <CalendarClock size={18} className="text-accent" aria-hidden />
            طلبات الحجز · Booking requests
          </CardTitle>
          <CardSubtitle className="mt-1">
            <span className="font-arabic">أكّد الموعد مع العميل ثم حدّث الحالة.</span> Confirm the time with the customer, then update the status.
          </CardSubtitle>
        </div>
        {bookings.length === 0 ? (
          <div className="border-t border-rule/30 p-6">
            <Empty title="لا توجد طلبات حجز · No booking requests" hint="الحجوزات التي يسجّلها المساعد من المكالمات تظهر هنا. · Bookings the agent records from calls appear here." />
          </div>
        ) : (
          <ul className="divide-y divide-rule/30 border-t border-rule/30">
            {bookings.map((b) => (
              <li key={b.id} className="space-y-2 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p dir="auto" className="font-arabic text-sm font-medium text-ink">
                      {b.name}
                    </p>
                    <a dir="ltr" href={`tel:${b.mobile}`} className="font-mono text-xs text-accent hover:underline">
                      {b.mobile}
                    </a>
                  </div>
                  <Badge tone={BOOKING_TONE[b.status]}>{`${BOOKING_STATUS_TEXT[b.status].ar} · ${BOOKING_STATUS_TEXT[b.status].en}`}</Badge>
                </div>
                {b.preferred_time && (
                  <p dir="auto" className="font-arabic text-xs text-ink-soft">
                    الموعد المطلوب · Requested: {b.preferred_time}
                  </p>
                )}
                {b.note && (
                  <p dir="auto" className="font-arabic text-xs text-ink-soft">
                    {b.note}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span dir="ltr" className="font-mono text-[11px] text-ink-mute">
                    {when(b.created_at)}
                  </span>
                  <label className="flex items-center gap-2 text-[11px] text-ink-mute">
                    <span>الحالة · Status</span>
                    <select
                      className="rounded-lg border border-rule/50 bg-paper/60 px-2 py-1 text-xs text-ink disabled:opacity-50"
                      value={b.status}
                      disabled={busyId === b.id}
                      onChange={(ev) => onBookingStatus(b.id, ev.target.value as VoiceBookingStatus)}
                    >
                      {(Object.keys(BOOKING_STATUS_TEXT) as VoiceBookingStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {`${BOOKING_STATUS_TEXT[s].ar} · ${BOOKING_STATUS_TEXT[s].en}`}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
