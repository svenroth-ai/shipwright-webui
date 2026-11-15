/*
 * event-log-instant.ts — parsed UTC instant of an event timestamp, pure (no I/O).
 *
 * Split out of `event-log-assemble.ts` (bloat ceiling). Twin of the Python reader's
 * `fromisoformat`-based sort key; the assembler sorts archive + drop records by it.
 */

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/**
 * Parsed UTC instant as `[epochMs, subMillisecond]`; unparseable sorts first.
 *
 * Hand-parsed rather than `Date.parse`: a NAIVE ISO time is UTC in the event-log
 * convention (Python reads it so) but LOCAL time to `Date.parse`, and Python keeps
 * microseconds, which a millisecond epoch would collapse into false ties.
 */
export function instantKey(ts: unknown): [number, number] {
  if (typeof ts !== "string") return [-Infinity, 0];
  const m = ISO.exec(ts.trim());
  if (!m) return [-Infinity, 0];
  const [, y, mo, d, h = "0", mi = "0", s = "0", frac = "", tz] = m;
  const [Y, M, D, H, MI, S] = [y, mo, d, h, mi, s].map(Number) as [number, number, number, number, number, number];
  // Python `fromisoformat` rejects an impossible date/time, so it must not sort as a real instant here.
  const dt = new Date(Date.UTC(2000, M - 1, D, H, MI, S));
  dt.setUTCFullYear(Y); // Date.UTC maps a year below 100 to 19xx
  if (Y < 1 || H > 23 || MI > 59 || S > 59 || dt.getUTCFullYear() !== Y || dt.getUTCMonth() !== M - 1 || dt.getUTCDate() !== D) {
    return [-Infinity, 0];
  }
  const base = dt.getTime();
  let offsetMs = 0;
  if (tz && tz.toUpperCase() !== "Z") {
    const sign = tz.startsWith("-") ? -1 : 1;
    const digits = tz.slice(1).replace(":", "");
    const [oh, om] = [Number(digits.slice(0, 2)), Number(digits.slice(2, 4) || "0")];
    if (oh > 23 || om > 59) return [-Infinity, 0];
    offsetMs = sign * (oh * 60 + om) * 60_000;
  }
  const fraction = `${frac}000000`.slice(0, 9);
  return [base - offsetMs + Number(fraction.slice(0, 3)), Number(fraction.slice(3))];
}
