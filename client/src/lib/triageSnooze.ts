/*
 * triageSnooze.ts — the Snooze presets (tomorrow, 1 week, 1 month) as plain
 * calendar dates (iterate-2026-11-08-triage-page-redesign).
 *
 * Calendar arithmetic is done on year/month/day numbers (via UTC fields),
 * never by adding milliseconds, so a daylight-saving change cannot shift a
 * preset by a day. "1 month" clamps to the last day of a shorter month
 * (Jan 31 → Feb 28). The server only accepts a date strictly in the future
 * of ITS day, so every preset is also floored at the UTC "tomorrow" — a
 * viewer west of UTC late in the evening would otherwise offer "tomorrow"
 * that the server still counts as today.
 */

interface Ymd {
  y: number;
  m: number; // 1-12
  d: number;
}

function addDays(base: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(base.y, base.m - 1, base.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addMonths(base: Ymd, n: number): Ymd {
  const idx = base.y * 12 + (base.m - 1) + n;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return { y, m, d: Math.min(base.d, daysInMonth(y, m)) };
}

function iso(v: Ymd): string {
  return `${v.y}-${String(v.m).padStart(2, "0")}-${String(v.d).padStart(2, "0")}`;
}

function localToday(now: Date): Ymd {
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

function utcToday(now: Date): Ymd {
  return { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, d: now.getUTCDate() };
}

/** The earliest date the server will accept (strictly after its today). */
export function minRevisitDate(now: Date = new Date()): string {
  const local = iso(addDays(localToday(now), 1));
  const utc = iso(addDays(utcToday(now), 1));
  return local > utc ? local : utc;
}

export interface SnoozePresets {
  tomorrow: string;
  week: string;
  month: string;
}

export function snoozePresets(now: Date = new Date()): SnoozePresets {
  const today = localToday(now);
  const floor = minRevisitDate(now);
  const atLeast = (v: Ymd) => {
    const s = iso(v);
    return s > floor ? s : floor;
  };
  return {
    tomorrow: atLeast(addDays(today, 1)),
    week: atLeast(addDays(today, 7)),
    month: atLeast(addMonths(today, 1)),
  };
}
