/*
 * reminderModel — what one due item (a reminder, or a parked triage entry whose
 * revisit day has come) looks like as an Inbox row and as a detail dialog
 * (campaign reminders-webui, W3). Pure: the row, the dialog and the filter bar
 * read this one shape and never switch on the kind themselves.
 *
 * Every text field is untrusted. Nothing here parses or rewrites it: it stays a
 * string and is rendered through React (escaped). The stored `command` is
 * display text only — "Start task" never reads it (it builds a launch from the
 * item's kind and id through the Fix-now machinery).
 */
import { hasData, type ReminderItem, type ReminderProjectDue } from "../../lib/remindersApi";

export type ReminderFilter = "reminders" | "parked";

export interface ReminderEntry {
  projectId: string;
  /** The server's day ("today" for this answer). */
  on: string;
  item: ReminderItem;
  /** Stable React key / testid base, unique across projects. */
  key: string;
}

export interface ReminderRowModel {
  filter: ReminderFilter;
  chip: { label: string; tone: "reminder" | "parked" };
  title: string;
  /** Right-hand meta of the row: "due today", "park expired 4d ago". */
  dueText: string;
  /** Dialog label + value for the day. */
  dayLabel: string;
  dayValue: string;
  /** Reminder id (`rem-...`) / triage id (`trg-...`), as shown and copied. */
  idText: string;
  /** Done and Snooze exist for reminders only, never for a parked triage entry. */
  canAct: boolean;
  /** "Start task" needs a stored command to be offered at all (it is never RUN from it). */
  canStart: boolean;
}

const DAY_MS = 86_400_000;

function dayNumber(day: string | null): number | null {
  if (!day) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
}

/** Whole days from `due` up to `on` (positive = the day has passed). Null when either is not a day. */
export function daysPast(on: string, due: string | null): number | null {
  const a = dayNumber(on);
  const b = dayNumber(due);
  return a === null || b === null ? null : a - b;
}

function relative(n: number | null): string {
  if (n === null) return "";
  if (n === 0) return "today";
  if (n > 0) return n === 1 ? "1 day ago" : `${n} days ago`;
  return n === -1 ? "in 1 day" : `in ${-n} days`;
}

export function reminderRowModel(entry: ReminderEntry): ReminderRowModel {
  const { item, on } = entry;
  const n = daysPast(on, item.due);
  const isTriage = item.kind === "triage";
  const short = n === null ? "" : n === 0 ? "today" : n > 0 ? `${n}d ago` : `in ${-n}d`;
  const dueText = isTriage
    ? `park expired ${short || "(day unknown)"}`
    : `due ${short || "(day unknown)"}`;
  return {
    filter: isTriage ? "parked" : "reminders",
    chip: isTriage
      ? { label: "parked triage", tone: "parked" }
      : { label: "reminder", tone: "reminder" },
    title: item.title?.trim() ? item.title : "(untitled)",
    dueText,
    dayLabel: isTriage ? "Revisit day" : "Due",
    dayValue: item.due ? `${item.due}${n === null ? "" : ` (${relative(n)})`}` : "(no day)",
    idText: item.id ?? "",
    canAct: !isTriage && item.id !== null,
    canStart: !isTriage && item.id !== null && item.command !== null && item.command.trim() !== "",
  };
}

/** Flatten one answer into entries; a problem state or a shared store yields none of the data it lacks. */
export function entriesForProject(p: ReminderProjectDue): ReminderEntry[] {
  if (!hasData(p)) return [];
  return (p.items ?? []).map((item, i) => ({
    projectId: p.projectId,
    on: p.on ?? "",
    item,
    key: `${item.kind}-${p.projectId}-${item.id ?? `n${i}`}`,
  }));
}

/** Reminders first, then parked triage; oldest day first inside each. Stable. */
export function sortEntries(entries: readonly ReminderEntry[]): ReminderEntry[] {
  const rank = (e: ReminderEntry) => (e.item.kind === "reminder" ? 0 : 1);
  return [...entries].sort((a, b) => rank(a) - rank(b) || (a.item.due ?? "").localeCompare(b.item.due ?? ""));
}
