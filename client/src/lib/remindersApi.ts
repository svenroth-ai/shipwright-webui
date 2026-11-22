/*
 * remindersApi.ts — fetch wrappers for /api/reminders/* (campaign
 * reminders-webui, W3). Types are verbatim mirrors of the server's answer
 * (server/src/routes/reminders.ts + core/reminder-contract.ts); no
 * cross-package import (CLAUDE.md DO-NOT #7).
 *
 * Every text field is UNTRUSTED (triage text can come from external issues).
 * This module never interprets one; every consumer renders it as plain text
 * through React.
 */

export const REMINDERS_API = "/api/reminders";

export interface ReminderLink {
  label: string | null;
  kind: string | null;
  ref: string | null;
}

export interface ReminderItem {
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

/** One registered project's answer. `ok` / `degraded` carry data; every other state is a problem. */
export interface ReminderProjectDue {
  projectId: string;
  state:
    | "ok"
    | "degraded"
    | "engine-unavailable"
    | "store-busy"
    | "unsupported-version"
    | "unreadable"
    | "failed"
    | (string & {});
  on?: string;
  reminderCorruptLines?: number;
  triageError?: string | null;
  items?: ReminderItem[];
  /** Another registration reaches the same store; its reminders are listed there, once. */
  remindersSharedWithProjectId?: string;
  reason?: string;
}

export interface RemindersDueResponse {
  projects: ReminderProjectDue[];
}

export function hasData(p: ReminderProjectDue): boolean {
  return (p.state === "ok" || p.state === "degraded") && Array.isArray(p.items);
}

export async function fetchRemindersDue(): Promise<RemindersDueResponse> {
  const r = await fetch(`${REMINDERS_API}/due`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = (await r.json()) as RemindersDueResponse;
  if (!json || !Array.isArray(json.projects)) throw new Error("Unreadable reminders answer");
  return json;
}

export type ReminderWriteResult = { ok: true } | { ok: false; status: number; message: string };

async function post(projectId: string, verb: "done" | "snooze" | "add", body: unknown): Promise<ReminderWriteResult> {
  try {
    const r = await fetch(`${REMINDERS_API}/${encodeURIComponent(projectId)}/${verb}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) return { ok: true };
    const j = ((await r.json().catch(() => null)) ?? {}) as { message?: string; reason?: string; error?: string };
    // The CLI's own plain wording (e.g. the secret refusal) is passed through unchanged.
    return { ok: false, status: r.status, message: j.message || j.reason || `The request failed (${r.status}).` };
  } catch {
    return { ok: false, status: 0, message: "Could not reach the server." };
  }
}

export const reminderDone = (projectId: string, id: string) => post(projectId, "done", { id });

export const reminderSnooze = (projectId: string, id: string, until: string) =>
  post(projectId, "snooze", { id, until });

export interface ReminderAddBody {
  title: string;
  due: string;
  why: string;
  decided?: string;
  open?: string;
  command?: string;
  links?: { label: string; ref: string }[];
}

export const reminderAdd = (projectId: string, body: ReminderAddBody) => post(projectId, "add", body);
