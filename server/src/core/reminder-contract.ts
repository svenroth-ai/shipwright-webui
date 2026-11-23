/*
 * reminder-contract.ts — the WebUI side of the `reminder_cli.py due --json`
 * contract (Shipwright `lib/reminder_due.py`, "Cross-repo contract").
 *
 * PINNED. Any change to the envelope, the 10 item fields or the 3 link fields
 * on the Shipwright side needs a `contractVersion` bump and a matching change
 * here; `reminder-contract.test.ts` pins the shape. A version we do not know is
 * never half-read: it becomes the `unsupported-version` state.
 *
 * Every text field is UNTRUSTED (triage text can originate in external
 * issues). This module only validates and narrows the shape; it never
 * interprets a field. Consumers must escape on render.
 *
 * `sourceRoot` / `reminderStore` are local paths and are deliberately NOT
 * carried into `ReminderDueView` — they must never reach a mail body.
 */

export const SUPPORTED_CONTRACT_VERSION = 1;

export const REMINDER_ITEM_FIELDS = [
  "kind", "id", "title", "due", "why", "decided", "open", "command", "links", "severity",
] as const;
export const REMINDER_LINK_FIELDS = ["label", "kind", "ref"] as const;

export interface ReminderLink {
  label: string | null;
  kind: string | null;
  ref: string | null;
}

export interface ReminderDueItem {
  kind: "reminder" | "triage";
  id: string | null;
  title: string | null;
  due: string | null;
  why: string | null;
  decided: string | null;
  open: string | null;
  command: string | null;
  links: ReminderLink[];
  severity: string | null;
}

/** The validated answer, minus the local-path fields. */
export interface ReminderDueView {
  contractVersion: 1;
  on: string;
  /** Non-zero means the store has unreadable lines: show a hint, never hide it. */
  reminderCorruptLines: number;
  /** Non-null means the triage side was NOT read: "nothing due" is unproven. */
  triageError: string | null;
  items: ReminderDueItem[];
}

export type ReminderDueParse =
  | { kind: "ok"; view: ReminderDueView; storeKey: string | null }
  | { kind: "unsupported-version"; contractVersion: unknown }
  | { kind: "unreadable"; reason: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isHttpUrl = (v: string): boolean => {
  try {
    const p = new URL(v).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
};

function parseLink(raw: unknown): ReminderLink | null {
  if (!isRecord(raw)) return null;
  const { label, kind, ref } = raw;
  if (!strOrNull(label) || !strOrNull(kind) || !strOrNull(ref)) return null;
  // A `url` link whose address is not http(s) (javascript:, data:, ...) must never become a live
  // href in a later page or mail: its address is dropped, the label stays as plain text.
  return { label, kind, ref: kind === "url" && ref !== null && !isHttpUrl(ref) ? null : ref };
}

function parseItem(raw: unknown): ReminderDueItem | null {
  if (!isRecord(raw)) return null;
  for (const f of REMINDER_ITEM_FIELDS) if (!(f in raw)) return null;
  if (raw.kind !== "reminder" && raw.kind !== "triage") return null;
  const text = ["id", "title", "due", "why", "decided", "open", "command", "severity"] as const;
  for (const f of text) if (!strOrNull(raw[f])) return null;
  if (!Array.isArray(raw.links)) return null;
  const links: ReminderLink[] = [];
  for (const l of raw.links) {
    const parsed = parseLink(l);
    if (!parsed) return null;
    links.push(parsed);
  }
  return {
    kind: raw.kind,
    id: raw.id as string | null,
    title: raw.title as string | null,
    due: raw.due as string | null,
    why: raw.why as string | null,
    decided: raw.decided as string | null,
    open: raw.open as string | null,
    command: raw.command as string | null,
    links,
    severity: raw.severity as string | null,
  };
}

/**
 * The CLI words "this project has no triage log at all" (no `.shipwright` folder) as
 * `the triage log could not be read (FileNotFoundError)`. That is not a read failure:
 * there is simply nothing parked to check, so it must not raise the "could not be checked"
 * warning for ever. Any other exception name (PermissionError, ...) stays a real error.
 * Known limit: it keys on the CLI's message text, so a rare FileNotFoundError raised
 * while reading an existing log reads the same (transient; self-heals on the next poll).
 * A structured code from the CLI would make this exact. A wrong triage root (the CLI checks the
 * nearest .git ancestor) reads the same and is hidden too. The reminder-mail note is dropped
 * for such a project as well, consistently (it shares this parse).
 */
function isNoTriageLog(triageError: string | null): boolean {
  return triageError !== null && /\(FileNotFoundError\)\s*$/.test(triageError);
}

/** Parse the CLI's stdout. Never throws; anything off-contract is a named state. */
export function parseDueAnswer(stdout: string): ReminderDueParse {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return { kind: "unreadable", reason: "The answer was not valid JSON." };
  }
  if (!isRecord(raw)) return { kind: "unreadable", reason: "The answer was not a JSON object." };
  if (typeof raw.contractVersion !== "number" && typeof raw.contractVersion !== "string") {
    return { kind: "unreadable", reason: "The answer names no contract version." };
  }
  if (raw.contractVersion !== SUPPORTED_CONTRACT_VERSION) {
    return { kind: "unsupported-version", contractVersion: raw.contractVersion };
  }
  const { on, reminderCorruptLines, triageError, items } = raw;
  if (typeof on !== "string" || !DAY.test(on)) return { kind: "unreadable", reason: "The answer has no valid day." };
  if (typeof reminderCorruptLines !== "number" || !Number.isInteger(reminderCorruptLines) || reminderCorruptLines < 0) {
    return { kind: "unreadable", reason: "The answer has no valid damaged-line count." };
  }
  if (triageError !== null && typeof triageError !== "string") {
    return { kind: "unreadable", reason: "The answer has an invalid triage status." };
  }
  if (!Array.isArray(items)) return { kind: "unreadable", reason: "The answer has no item list." };
  const parsed: ReminderDueItem[] = [];
  for (const it of items) {
    const p = parseItem(it);
    if (!p) return { kind: "unreadable", reason: "An item in the answer does not match the contract." };
    parsed.push(p);
  }
  // The store path itself never leaves the server; it only identifies WHICH store answered.
  const storeKey = typeof raw.reminderStore === "string" ? raw.reminderStore : null;
  return {
    kind: "ok",
    view: {
      contractVersion: 1,
      on,
      reminderCorruptLines,
      triageError: isNoTriageLog(triageError) ? null : triageError,
      items: parsed,
    },
    storeKey,
  };
}
