import type { SaudiCalendarEvent } from "./types";

/**
 * Saudi calendar of moments that matter for an SMB's social posting.
 * Dates are illustrative; religious dates shift annually with the Hijri calendar
 * and should be fetched from an authoritative source (e.g., Umm Al-Qura) at runtime.
 *
 * The planner agent uses `importance` to scale post frequency around each event.
 */
export const SAUDI_CALENDAR_2026: SaudiCalendarEvent[] = [
  { date: "2026-01-22", name: "Founding Day", arabicName: "يوم التأسيس", type: "national", importance: 3 },
  { date: "2026-02-14", name: "Valentine's commerce window", arabicName: "نافذة فبراير التجارية", type: "shopping", importance: 1 },
  { date: "2026-02-18", name: "Ramadan begins (approx.)", arabicName: "بداية رمضان", type: "religious", importance: 3 },
  { date: "2026-03-20", name: "Ramadan mid-month", arabicName: "منتصف رمضان", type: "religious", importance: 2 },
  { date: "2026-03-30", name: "Eid Al-Fitr (approx.)", arabicName: "عيد الفطر", type: "religious", importance: 3 },
  { date: "2026-05-26", name: "Hajj season begins", arabicName: "موسم الحج", type: "religious", importance: 2 },
  { date: "2026-06-06", name: "Eid Al-Adha (approx.)", arabicName: "عيد الأضحى", type: "religious", importance: 3 },
  { date: "2026-09-23", name: "National Day", arabicName: "اليوم الوطني", type: "national", importance: 3 },
  { date: "2026-11-25", name: "White Friday", arabicName: "الجمعة البيضاء", type: "shopping", importance: 3 },
  { date: "2026-11-28", name: "Cyber Monday MENA", arabicName: "إثنين الإنترنت", type: "shopping", importance: 2 },
  { date: "2026-12-15", name: "Riyadh Season peak", arabicName: "ذروة موسم الرياض", type: "season", importance: 2 }
];

export function nextSignificantEvents(from: Date, count = 5): SaudiCalendarEvent[] {
  const fromMs = from.getTime();
  return SAUDI_CALENDAR_2026
    .filter((e) => new Date(e.date).getTime() >= fromMs)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, count);
}
