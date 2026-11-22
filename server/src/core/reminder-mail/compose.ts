/*
 * compose.ts — builds the reminder mails (mockup page 05: dark header band with the inline logo, body, links).
 *
 * EVERY field is untrusted (triage text can originate in external issues). The
 * mail is plain text first; the HTML part is the same cleaned text, HTML-escaped,
 * with no scripts and no remote images (the logo is an inline attachment). Texts are cut at 1000 characters ("..."),
 * local paths are redacted, control characters and header-breaking newlines are
 * stripped. `command` is inert display text, never something to run; a `file`
 * link (a local path) is dropped, only http(s) `url` links are carried. The
 * local-path fields of the CLI answer never reach this module at all.
 */

import type { ReminderDueItem } from "../reminder-contract.js";
import { LOGO_CID } from "./logo.js";

export const MAX_FIELD_CHARS = 1000;
export const MAX_SUMMARY_ITEMS = 30;

export interface ComposedMail {
  subject: string;
  text: string;
  html: string;
}

export interface MailEntry {
  item: ReminderDueItem;
  projectId: string;
  projectName: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const WIN_PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'<>|]*/g;
const UNC_PATH = /\\\\[^\s\\]+\\[^\s"'<>|]*/g;
// A path starts where the previous character is not part of a word, a slash or a dot: backticks, brackets,
// colons, commas and angle brackets all count as "start", while "https://host/home/x" (preceded by a word
// character or a slash) is a web address and survives.
const POSIX_PATH = /(?<![\w/.])\/(?:[a-zA-Z]\/(?:Users|Documents and Settings)|Users|home|var|etc|opt|tmp|mnt|root|private|srv|usr|Volumes|workspace|data|builds|nix)\/[^\s"'<>|`\])]*/g;
const FILE_URL = /file:\/\/[^\s"'<>|]*/gi;
// Any other absolute path with at least two segments ("/projects/acme/x"), not a URL: a lone "/command" stays.
const ANY_ABS_PATH = /(?<![\w/.])\/[\w.@~-]+(?:\/[^\s"'<>|`\])]+)+/g;
const HOME_PATH = /(?<![\w~])~[\\/][^\s"'<>|`\])]*/g;

/** Plain-text hygiene shared by every field: no controls, no local paths, cut at `max`. */
export function clean(value: string | null | undefined, max = MAX_FIELD_CHARS): string {
  let s = (value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\r\n?/g, "\n");
  s = s.replace(WIN_PATH, "[path]").replace(UNC_PATH, "[path]").replace(FILE_URL, "[path]").replace(POSIX_PATH, "[path]").replace(ANY_ABS_PATH, "[path]").replace(HOME_PATH, "[path]");
  s = s.trim();
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

const oneLine = (v: string | null | undefined, max: number): string => clean(v, max).replace(/\s+/g, " ");

function origin(address: string): string {
  return new URL(address).origin;
}

function httpUrl(ref: string | null): string | null {
  if (!ref) return null;
  try {
    const u = new URL(ref);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function section(label: string, value: string | null | undefined): string | null {
  const v = clean(value);
  return v ? `${label}: ${v}` : null;
}

function itemLines(entry: MailEntry): { lines: string[]; links: { label: string; url: string }[] } {
  const { item } = entry;
  const kindLabel = item.kind === "triage" ? "Parked triage item expired" : "Reminder";
  const lines = [
    oneLine(item.title, 300) || "(no title)",
    `${kindLabel} - due ${oneLine(item.due, 20) || "?"} - project: ${oneLine(entry.projectName, 120) || "?"}`,
    "",
    section("Why", item.why),
    section("Decided", item.decided),
    section("Still open", item.open),
    section("Next step (text only, not run)", item.command),
  ].filter((l): l is string => l !== null);
  const links = item.links.flatMap((l) => {
    const url = l.kind === "url" ? httpUrl(l.ref) : null;
    return url ? [{ label: oneLine(l.label, 120) || url, url }] : [];
  });
  return { lines, links };
}

const FOOT_NOTE = "Mark it done or snooze it in your Inbox.";

function htmlWrap(bodyHtml: string): string {
  const band = `<div style="background:#23262C;padding:16px 22px"><img src="cid:${LOGO_CID}" alt="Shipwright" height="24" style="height:24px;display:block"></div>`;
  return `<!doctype html><html><body style="margin:0;font-family:Arial,Helvetica,sans-serif;color:#2b2724;line-height:1.5">${band}<div style="padding:20px 24px;max-width:660px">${bodyHtml}</div></body></html>`;
}

const pHtml = (s: string): string => `<p style="margin:0 0 8px;white-space:pre-wrap">${escapeHtml(s)}</p>`;

export function composeItemMail(entry: MailEntry, address: string): ComposedMail {
  const base = origin(address);
  const { lines, links } = itemLines(entry);
  const prefix = entry.item.kind === "triage" ? "Parked item expired" : "Due";
  const subject = `[Shipwright] ${prefix}: ${oneLine(entry.item.title, 120) || "(no title)"}`;
  const once = entry.item.kind === "triage"
    ? "This is the only mail for this parked item."
    : "This is the only mail for this item today.";
  const text = [
    ...lines,
    ...links.map((l) => `Link: ${l.label} - ${l.url}`),
    "",
    `Open in the Command Center: ${base}/inbox`,
    `${FOOT_NOTE} ${once}`,
    `Change reminder mail settings: ${base}/settings`,
  ].join("\n");
  const html = htmlWrap(
    [
      `<h2 style="margin:0 0 6px;font-size:18px">${escapeHtml(lines[0])}</h2>`,
      ...lines.slice(1).map((l) => pHtml(l)),
      // The label is untrusted: show where the link really goes next to it.
      ...links.map((l) => `<p style="margin:0 0 8px">Link: <a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a> (${escapeHtml(new URL(l.url).host)})</p>`),
      `<p><a href="${escapeHtml(base)}/inbox">Open in the Command Center</a></p>`,
      pHtml(`${FOOT_NOTE} ${once}`),
      `<p><a href="${escapeHtml(base)}/settings">Change reminder mail settings</a></p>`,
    ].join(""),
  );
  return { subject, text, html };
}

export interface SummaryContext {
  address: string;
  day: string;
  /** Non-empty when the check could not read everything: "nothing due" would be a lie. */
  problems: string[];
  /** Items that did not fit and are not in this mail. */
  more?: number;
}

export function composeSummaryMail(entries: MailEntry[], ctx: SummaryContext): ComposedMail {
  const base = origin(ctx.address);
  const n = entries.length + (ctx.more ?? 0);
  const subject = n === 0
    ? `[Shipwright] Daily summary ${ctx.day}: nothing due`
    : `[Shipwright] Daily summary ${ctx.day}: ${n} item${n === 1 ? "" : "s"} due`;
  const shown = entries.slice(0, MAX_SUMMARY_ITEMS).map((e) => {
    const tag = e.item.kind === "triage" ? "parked triage" : "reminder";
    return `- ${oneLine(e.item.title, 200) || "(no title)"} (${tag}, due ${oneLine(e.item.due, 20) || "?"}, ${oneLine(e.projectName, 80) || "?"})`;
  });
  if (n > shown.length) shown.push(`- ...and ${n - shown.length} more`);
  const head = n === 0 && ctx.problems.length === 0 ? "Nothing is due today." : n === 0 ? "No due item was found, but the check could not read everything." : "Due today:";
  const problemLines = ctx.problems.map((p) => `Note: ${oneLine(p, 200)}`);
  const text = [head, ...shown, ...problemLines, "", `Open in the Command Center: ${base}/inbox`, `Change reminder mail settings: ${base}/settings`].join("\n");
  const html = htmlWrap(
    [
      `<h2 style="margin:0 0 6px;font-size:18px">${escapeHtml(head)}</h2>`,
      shown.length ? `<ul>${shown.map((l) => `<li>${escapeHtml(l.slice(2))}</li>`).join("")}</ul>` : "",
      ...problemLines.map((l) => pHtml(l)),
      `<p><a href="${escapeHtml(base)}/inbox">Open in the Command Center</a></p>`,
      `<p><a href="${escapeHtml(base)}/settings">Change reminder mail settings</a></p>`,
    ].join(""),
  );
  return { subject, text, html };
}

export function composeTestMail(address: string): ComposedMail {
  const base = origin(address);
  const text = `This is a test mail from the Shipwright Command Center.\nIf you can read it, reminder mail is set up correctly.\n\nChange reminder mail settings: ${base}/settings`;
  return {
    subject: "[Shipwright] Test mail",
    text,
    html: htmlWrap(`${pHtml("This is a test mail from the Shipwright Command Center.")}${pHtml("If you can read it, reminder mail is set up correctly.")}<p><a href="${escapeHtml(base)}/settings">Change reminder mail settings</a></p>`),
  };
}
