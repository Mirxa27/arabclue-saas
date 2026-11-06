/**
 * SW-48: the Saudi calendar is computed for any year and matches published dates.
 *
 * Expected Hijri dates (Umm al-Qura; read 2026-11-06):
 *  - 1447: Ramadan began 2026-02-18 and Eid al-Fitr was 2026-03-20 (Gulf News, 18 Mar 2026);
 *    Arafah 2026-05-26, Eid al-Adha 2026-05-27 (Saudi Supreme Court, 17 May 2026).
 *  - 1448–1452: hijri-calendars.com Umm al-Qura occasions table.
 */
import { describe, expect, it } from "vitest";
import {
  eventsBetween,
  hijriMonthDay,
  nextSignificantEvents,
  riyadhDate,
  saudiCalendarFor,
  whiteFriday
} from "@/lib/social/calendar";

const dateOf = (year: number, name: string) => saudiCalendarFor(year).filter((e) => e.name === name).map((e) => e.date);

const PUBLISHED: Array<{ year: number; ramadan: string[]; fitr: string[]; arafah: string[]; adha: string[] }> = [
  { year: 2026, ramadan: ["2026-02-18"], fitr: ["2026-03-20"], arafah: ["2026-05-26"], adha: ["2026-05-27"] },
  { year: 2027, ramadan: ["2027-02-08"], fitr: ["2027-03-09"], arafah: ["2027-05-15"], adha: ["2027-05-16"] },
  { year: 2028, ramadan: ["2028-01-28"], fitr: ["2028-02-26"], arafah: ["2028-05-04"], adha: ["2028-05-05"] },
  { year: 2029, ramadan: ["2029-01-16"], fitr: ["2029-02-14"], arafah: ["2029-04-23"], adha: ["2029-04-24"] },
  // 2030 has two Ramadans: 1451 (Jan) and 1452 (Dec)
  { year: 2030, ramadan: ["2030-01-05", "2030-12-26"], fitr: ["2030-02-04"], arafah: ["2030-04-12"], adha: ["2030-04-13"] }
];

describe("Saudi calendar (computed)", () => {
  it.each(PUBLISHED)("Hijri events in $year match the Umm al-Qura / announced dates", ({ year, ramadan, fitr, arafah, adha }) => {
    expect(dateOf(year, "Ramadan begins")).toEqual(ramadan);
    expect(dateOf(year, "Eid al-Fitr")).toEqual(fitr);
    expect(dateOf(year, "Day of Arafah")).toEqual(arafah);
    expect(dateOf(year, "Eid al-Adha")).toEqual(adha);
    for (const e of saudiCalendarFor(year).filter((x) => x.type === "religious")) expect(e.approximate).toBe(true);
  });

  it("puts Islamic New Year 1448 on 2026-06-16 and mid-Ramadan 1447 on 2026-03-04", () => {
    expect(dateOf(2026, "Islamic New Year")).toEqual(["2026-06-16"]);
    expect(dateOf(2026, "Mid-Ramadan (Gerga'an)")).toEqual(["2026-03-04"]);
    expect(hijriMonthDay("2026-03-20")).toMatchObject({ month: 10, day: 1, year: 1447 });
  });

  it.each([2026, 2027, 2028, 2029, 2030])("fixed national days in %i: Founding Day 22 Feb, Flag Day 11 Mar, National Day 23 Sep", (year) => {
    expect(dateOf(year, "Founding Day")).toEqual([`${year}-02-22`]);
    expect(dateOf(year, "Flag Day")).toEqual([`${year}-03-11`]);
    expect(dateOf(year, "Saudi National Day")).toEqual([`${year}-09-23`]);
  });

  it("White Friday is the Friday after the fourth Thursday of November; Cyber Monday 3 days later", () => {
    expect(whiteFriday(2026)).toBe("2026-11-27");
    expect(whiteFriday(2027)).toBe("2027-11-26");
    expect(whiteFriday(2030)).toBe("2030-11-29");
    for (let year = 2026; year <= 2035; year++) {
      const [friday] = dateOf(year, "White Friday");
      const [monday] = dateOf(year, "Cyber Monday");
      expect(new Date(`${friday}T00:00:00Z`).getUTCDay()).toBe(5);
      expect(new Date(`${monday}T00:00:00Z`).getUTCDay()).toBe(1);
    }
    expect(dateOf(2026, "Cyber Monday")).toEqual(["2026-11-30"]);
  });

  it("never runs out: every week from 2026 to 2035 has at least 3 events in the next 90 days", () => {
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2036, 0, 1); t += 7 * 86_400_000) {
      const from = new Date(t);
      const events = eventsBetween(from, new Date(t + 90 * 86_400_000));
      expect(events.length, from.toISOString()).toBeGreaterThanOrEqual(3);
    }
  });

  it("from mid-January 2027 the next events include Founding Day and Ramadan 1448", () => {
    const next = nextSignificantEvents(new Date("2027-01-15T09:00:00Z"), 12);
    expect(next.map((e) => `${e.date} ${e.name}`)).toEqual(
      expect.arrayContaining(["2027-02-08 Ramadan begins", "2027-02-22 Founding Day"])
    );
    // the old table ended on 2026-12-15 and returned [] from 2026-12-16 on
    expect(nextSignificantEvents(new Date("2026-12-16T00:00:00Z"), 5)).toHaveLength(5);
  });

  it("compares by Riyadh calendar day: an event stays upcoming for its whole day", () => {
    // 2026-09-23 20:30 in Riyadh (17:30Z) — still National Day
    const evening = new Date("2026-09-23T17:30:00Z");
    expect(riyadhDate(evening)).toBe("2026-09-23");
    expect(nextSignificantEvents(evening, 1)[0]).toMatchObject({ date: "2026-09-23", name: "Saudi National Day" });
    // 23:30Z on the 22nd is already the 23rd in Riyadh
    expect(riyadhDate(new Date("2026-09-22T23:30:00Z"))).toBe("2026-09-23");
  });

  it("returns events sorted ascending and respects the count", () => {
    const upcoming = nextSignificantEvents(new Date("2026-04-01T00:00:00Z"), 7);
    expect(upcoming).toHaveLength(7);
    const dates = upcoming.map((e) => e.date);
    expect(dates).toEqual([...dates].sort());
    expect(dates[0] >= "2026-04-01").toBe(true);
  });
});
