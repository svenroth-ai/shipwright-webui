/*
 * inboxViewStorage.ts — versioned, validated persistence of the Inbox page's
 * view (which project groups are folded, and the user's own project order) in
 * localStorage (iterate-2026-11-13-inbox-triage-look).
 *
 * Same rules as triageViewStorage: every storage access is in try/catch, a
 * read NEVER throws, anything unreadable or of the wrong shape falls back to
 * the defaults, and unknown values are dropped rather than interpreted. Keys
 * are project ids (the synthesized "unassigned" bucket included). View-only:
 * nothing here touches the server, the task store or Claude's JSONL.
 */

export const INBOX_VIEW_STORAGE_KEY = "shipwright:inbox-view:v1";
const VERSION = 1;
const MAX_STRINGS = 100;
const MAX_STRING_LEN = 80;

export interface InboxViewSnapshot {
  /** Project ids whose group is folded. */
  collapsed: string[];
  /** The user's own order of the project groups (project ids). */
  projectOrder: string[];
}

export function defaultInboxView(): InboxViewSnapshot {
  return { collapsed: [], projectOrder: [] };
}

function pickIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.filter(
    (v): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_STRING_LEN,
  );
  // Order matters for projectOrder, so dedupe into an array (not a Set-only shape).
  return [...new Set(ids)].slice(0, MAX_STRINGS);
}

/** Parses a stored string. Never throws; returns the defaults for anything bad. */
export function parseInboxView(raw: string | null): InboxViewSnapshot {
  if (!raw) return defaultInboxView();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return defaultInboxView();
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return defaultInboxView();
  const rec = data as Record<string, unknown>;
  if (rec.v !== VERSION) return defaultInboxView();
  return { collapsed: pickIds(rec.collapsed), projectOrder: pickIds(rec.projectOrder) };
}

export function serializeInboxView(view: InboxViewSnapshot): string {
  return JSON.stringify({ v: VERSION, collapsed: view.collapsed, projectOrder: view.projectOrder });
}

export function loadInboxView(): InboxViewSnapshot {
  try {
    return parseInboxView(window.localStorage.getItem(INBOX_VIEW_STORAGE_KEY));
  } catch {
    return defaultInboxView();
  }
}

export function saveInboxView(view: InboxViewSnapshot): void {
  try {
    window.localStorage.setItem(INBOX_VIEW_STORAGE_KEY, serializeInboxView(view));
  } catch {
    /* storage unavailable — the view simply is not remembered */
  }
}
