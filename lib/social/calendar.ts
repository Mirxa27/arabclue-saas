/**
 * Saudi moments that matter for an SMB's social calendar — computed for any year, never a
 * hard-coded list that runs out (SW-48).
 *
 * Hijri events use the Umm al-Qura calendar (Saudi Arabia's official civil calendar) through the
 * runtime's ICU data: `Intl.DateTimeFormat("en-u-ca-islamic-umalqura")`. Religious dates are
 * confirmed by the Supreme Court's moon sighting and can move by a day, so they are flagged
 * `approximate`. Checked against (read 2026-11-06):
 *   - 1447 AH: Ramadan began Wed 18 Feb 2026 and Eid al-Fitr was Fri 20 Mar 2026 (Gulf News,
 *     18 Mar 2026); Arafah Tue 26 May and Eid al-Adha Wed 27 May 2026 (Saudi Supreme Court,
 *     17 May 2026) — all equal to the Umm al-Qura computation.
 *   - 1448–1452 AH: hijri-calendars.com's Umm al-Qura table (e.g. Ramadan 8 Feb 2027 / 28 Jan 2028
 *     / 16 Jan 2029 / 5 Jan 2030 / 26 Dec 2030; Eid al-Adha 16 May 2027 / 5 May 2028 /
 *     24 Apr 2029 / 13 Apr 2030) — asserted in __tests__/social/calendar.test.ts.
 *
 * Gregorian events are fixed by decree or by definition:
 *   - Founding Day 22 Feb (royal order of 27 Jan 2022 — Arab News / Argaam), Flag Day 11 Mar
 *     (royal order A/303 of 1 Mar 2023 — Gulf News / The National), National Day 23 Sep;
 *   - White Friday = the Friday after the fourth Thursday of November, Cyber Monday = 3 days later,
 *     11.11 on 11 Nov;
 *   - government payday on the 27th of each Gregorian month (royal directive, Argaam; paid a day
 *     or two earlier when the 27th falls on the Friday/Saturday weekend → approximate).
 *
 * Dates are calendar days in Asia/Riyadh (UTC+3 all year, no DST), compared as YYYY-MM-DD so an
 * event stays "upcoming" for its whole day.
 */
import type { SaudiCalendarEvent } from "./types";

const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar day (YYYY-MM-DD) in Asia/Riyadh for an instant. */
export function riyadhDate(at: Date): string {
  return new Date(at.getTime() + RIYADH_OFFSET_MS).toISOString().slice(0, 10);
}

type EventTemplate = Omit<SaudiCalendarEvent, "date">;

type DatedTemplate = { month: number; day: number } & EventTemplate;

const HIJRI_EVENTS: readonly DatedTemplate[] = [
  { month: 9, day: 1, name: "Ramadan begins", arabicName: "بداية شهر رمضان", type: "religious", importance: 3, approximate: true },
  { month: 9, day: 15, name: "Mid-Ramadan (Gerga'an)", arabicName: "منتصف رمضان (القرقيعان)", type: "religious", importance: 2, approximate: true },
  { month: 9, day: 21, name: "Last ten nights of Ramadan", arabicName: "العشر الأواخر من رمضان", type: "religious", importance: 2, approximate: true },
  { month: 10, day: 1, name: "Eid al-Fitr", arabicName: "عيد الفطر", type: "religious", importance: 3, approximate: true },
  { month: 12, day: 8, name: "Hajj begins", arabicName: "بداية مناسك الحج", type: "religious", importance: 2, approximate: true },
  { month: 12, day: 9, name: "Day of Arafah", arabicName: "يوم عرفة", type: "religious", importance: 2, approximate: true },
  { month: 12, day: 10, name: "Eid al-Adha", arabicName: "عيد الأضحى", type: "religious", importance: 3, approximate: true },
  { month: 1, day: 1, name: "Islamic New Year", arabicName: "رأس السنة الهجرية", type: "religious", importance: 1, approximate: true }
];

const FIXED_GREGORIAN: readonly DatedTemplate[] = [
  { month: 2, day: 22, name: "Founding Day", arabicName: "يوم التأسيس", type: "national", importance: 3 },
  { month: 3, day: 11, name: "Flag Day", arabicName: "يوم العلم", type: "national", importance: 1 },
  { month: 9, day: 23, name: "Saudi National Day", arabicName: "اليوم الوطني السعودي", type: "national", importance: 3 },
  { month: 11, day: 11, name: "11.11 sales", arabicName: "تخفيضات ١١.١١", type: "shopping", importance: 1 }
];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

let hijriFormatter: Intl.DateTimeFormat | null | undefined;
function umalqura(): Intl.DateTimeFormat | null {
  if (hijriFormatter === undefined) {
    const f = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
      timeZone: "UTC",
      year: "numeric",
      month: "numeric",
      day: "numeric"
    });
    // A runtime without full ICU silently falls back to the Gregorian calendar.
    hijriFormatter = f.resolvedOptions().calendar === "islamic-umalqura" ? f : null;
  }
  return hijriFormatter;
}

/** Hijri (Umm al-Qura) month/day of a civil date, or null without ICU calendar data. */
export function hijriMonthDay(date: string): { month: number; day: number; year: number } | null {
  const f = umalqura();
  if (!f) return null;
  const parts = f.formatToParts(new Date(`${date}T12:00:00Z`));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const month = get("month");
  const day = get("day");
  const year = get("year");
  return Number.isFinite(month) && Number.isFinite(day) ? { month, day, year } : null;
}

/** White Friday (the Gulf's Black Friday): the day after the fourth Thursday of November. */
export function whiteFriday(year: number): string {
  const first = new Date(Date.UTC(year, 10, 1));
  const firstThursday = 1 + ((4 - first.getUTCDay() + 7) % 7);
  return ymd(year, 11, firstThursday + 21 + 1);
}

const yearCache = new Map<number, SaudiCalendarEvent[]>();

/** Every event of a Gregorian year, sorted by date. */
export function saudiCalendarFor(year: number): SaudiCalendarEvent[] {
  const cached = yearCache.get(year);
  if (cached) return cached;
  const events: SaudiCalendarEvent[] = [];

  for (const e of FIXED_GREGORIAN) {
    const { month, day, ...rest } = e;
    events.push({ ...rest, date: ymd(year, month, day) });
  }

  const friday = whiteFriday(year);
  events.push({ date: friday, name: "White Friday", arabicName: "الجمعة البيضاء", type: "shopping", importance: 3 });
  const cyber = new Date(Date.parse(`${friday}T00:00:00Z`) + 3 * DAY_MS).toISOString().slice(0, 10);
  events.push({ date: cyber, name: "Cyber Monday", arabicName: "إثنين الإنترنت", type: "shopping", importance: 2 });

  for (let month = 1; month <= 12; month++) {
    events.push({
      date: ymd(year, month, 27),
      name: "Government payday",
      arabicName: "يوم صرف الرواتب",
      type: "shopping",
      importance: 1,
      approximate: true
    });
  }

  if (umalqura()) {
    for (let t = Date.UTC(year, 0, 1); t < Date.UTC(year + 1, 0, 1); t += DAY_MS) {
      const date = new Date(t).toISOString().slice(0, 10);
      const h = hijriMonthDay(date);
      if (!h) continue;
      for (const e of HIJRI_EVENTS) {
        if (e.month === h.month && e.day === h.day) {
          const { month: _m, day: _d, ...rest } = e;
          events.push({ ...rest, date });
        }
      }
    }
  }

  events.sort((a, b) => (a.date === b.date ? b.importance - a.importance : a.date < b.date ? -1 : 1));
  yearCache.set(year, events);
  return events;
}

/** Events on or after `from`'s Riyadh calendar day, nearest first. */
export function nextSignificantEvents(from: Date, count = 5): SaudiCalendarEvent[] {
  const today = riyadhDate(from);
  const year = Number(today.slice(0, 4));
  const out: SaudiCalendarEvent[] = [];
  for (let y = year; y <= year + 2 && out.length < count; y++) {
    for (const e of saudiCalendarFor(y)) {
      if (e.date >= today) out.push(e);
      if (out.length >= count) break;
    }
  }
  return out;
}

/** Events whose Riyadh calendar day falls in [start, end] (inclusive). */
export function eventsBetween(start: Date, end: Date): SaudiCalendarEvent[] {
  const first = riyadhDate(start);
  const last = riyadhDate(end);
  const out: SaudiCalendarEvent[] = [];
  for (let y = Number(first.slice(0, 4)); y <= Number(last.slice(0, 4)); y++) {
    for (const e of saudiCalendarFor(y)) if (e.date >= first && e.date <= last) out.push(e);
  }
  return out;
}
