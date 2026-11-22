/*
 * reminder-validation.ts — request-body parsing for the reminder write routes.
 *
 * Shape and size checks only. The Shipwright CLI stays the authority on what a
 * reminder may contain (including the secret refusal), so this never judges
 * content and never rewrites a value — it only stops input the CLI could
 * misread (an id or day in the wrong shape, an `=` inside a link label, which
 * the CLI's `LABEL=KIND=REF` form cannot carry) or that is far over its caps.
 * Limits mirror `lib/reminder_store.py` (MAX_TITLE 200, MAX_TEXT 2000,
 * MAX_LINKS 20) so a refusal arrives as a clear 400, not a CLI exit.
 */

import type { ReminderAddInput } from "./reminder-cli-runner.js";

export const MAX_TITLE = 200;
export const MAX_TEXT = 2000;
export const MAX_LINKS = 20;
/** Windows caps a command line at 32,767 chars; stay well under it for the whole argv. */
export const MAX_TOTAL_CHARS = 24_000;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const REMINDER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function isRealDay(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = DAY.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === v;
}

const hasNul = (v: string): boolean => v.includes(String.fromCharCode(0));

const asObject = (b: unknown): Record<string, unknown> | null =>
  typeof b === "object" && b !== null && !Array.isArray(b) ? (b as Record<string, unknown>) : null;

/** Only http(s): a `javascript:` / `data:` address would be a live href in a later render or mail. */
export function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseReminderId(body: unknown): Parsed<string> {
  const o = asObject(body);
  if (!o || typeof o.id !== "string" || !REMINDER_ID.test(o.id)) return fail("id must be a reminder id.");
  return { ok: true, value: o.id };
}

export function parseSnoozeBody(body: unknown): Parsed<{ id: string; until: string }> {
  const id = parseReminderId(body);
  if (!id.ok) return id;
  const until = (body as Record<string, unknown>).until;
  if (!isRealDay(until)) return fail("until must be a day in YYYY-MM-DD form.");
  return { ok: true, value: { id: id.value, until } };
}

function optionalText(o: Record<string, unknown>, key: string): Parsed<string | undefined> {
  const v = o[key];
  if (v === undefined || v === null || v === "") return { ok: true, value: undefined };
  if (typeof v !== "string") return fail(`${key} must be text.`);
  if (v.length > MAX_TEXT) return fail(`${key} is longer than ${MAX_TEXT} characters.`);
  if (hasNul(v)) return fail(`${key} contains an invalid character.`);
  return { ok: true, value: v };
}

function requiredText(o: Record<string, unknown>, key: string, limit: number): Parsed<string> {
  const v = o[key];
  if (typeof v !== "string" || v.trim() === "") return fail(`${key} is required.`);
  if (v.length > limit) return fail(`${key} is longer than ${limit} characters.`);
  if (hasNul(v)) return fail(`${key} contains an invalid character.`);
  return { ok: true, value: v };
}

export function parseAddBody(body: unknown): Parsed<ReminderAddInput> {
  const o = asObject(body);
  if (!o) return fail("A JSON object is required.");
  const title = requiredText(o, "title", MAX_TITLE);
  if (!title.ok) return title;
  const why = requiredText(o, "why", MAX_TEXT);
  if (!why.ok) return why;
  if (!isRealDay(o.due)) return fail("due must be a day in YYYY-MM-DD form.");
  const out: ReminderAddInput = { title: title.value, due: o.due, why: why.value };
  for (const key of ["decided", "open", "command"] as const) {
    const t = optionalText(o, key);
    if (!t.ok) return t;
    if (t.value !== undefined) out[key] = t.value;
  }
  if (o.links !== undefined && o.links !== null) {
    if (!Array.isArray(o.links)) return fail("links must be a list.");
    if (o.links.length > MAX_LINKS) return fail(`At most ${MAX_LINKS} links are allowed.`);
    const links: { label: string; ref: string }[] = [];
    for (const raw of o.links) {
      const l = asObject(raw);
      if (!l) return fail("Each link needs a label and an address.");
      if (l.kind !== undefined && l.kind !== "url") return fail('Only links of kind "url" can be added.');
      const label = requiredText(l, "label", MAX_TITLE);
      if (!label.ok) return fail("Each link needs a label.");
      if (label.value.includes("=")) return fail("A link label cannot contain '='.");
      const ref = requiredText(l, "ref", MAX_TEXT);
      if (!ref.ok) return fail("Each link needs an address.");
      if (!isHttpUrl(ref.value)) return fail("A link address must be an http or https URL.");
      links.push({ label: label.value, ref: ref.value });
    }
    if (links.length) out.links = links;
  }
  const total = out.title.length + out.why.length + (out.decided?.length ?? 0) + (out.open?.length ?? 0) +
    (out.command?.length ?? 0) + (out.links ?? []).reduce((n, l) => n + l.label.length + l.ref.length, 0);
  if (total > MAX_TOTAL_CHARS) return fail(`The reminder text is too long in total (over ${MAX_TOTAL_CHARS} characters).`);
  return { ok: true, value: out };
}
