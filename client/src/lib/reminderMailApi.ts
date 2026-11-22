/*
 * reminderMailApi.ts — fetch wrappers for /api/reminder-mail (campaign
 * reminders-webui, W4). Types are verbatim mirrors of the server's answer
 * (server/src/routes/reminder-mail.ts + core/reminder-mail/settings.ts); no
 * cross-package import (CLAUDE.md DO-NOT #7).
 *
 * The SMTP password is WRITE-ONLY: the server never sends it back, only
 * `passwordSet`. Error text from the server is shown as plain text.
 */

export const REMINDER_MAIL_API = "/api/reminder-mail";

export type MailFormat = "item" | "summary" | "both";
export type CheckInterval = "15m" | "1h" | "daily";

export interface ReminderMailSettings {
  enabled: boolean;
  recipient: string;
  format: MailFormat;
  summaryTime: string;
  summaryWhenEmpty: boolean;
  webuiAddress: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  checkInterval: CheckInterval;
}

export interface ReminderMailStatus {
  lastCheckAt: string | null;
  lastSent: number;
  error: { at: string; message: string; recipient: string } | null;
  notes: string[];
}

export interface ReminderMailView {
  settings: ReminderMailSettings;
  passwordSet: boolean;
  status: ReminderMailStatus;
}

/** `password` is write-only; `clearPassword` removes the saved one; omitting both keeps it. */
export type ReminderMailSaveBody = ReminderMailSettings & { password?: string; clearPassword?: boolean };

export async function fetchReminderMail(): Promise<ReminderMailView> {
  const r = await fetch(REMINDER_MAIL_API);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as ReminderMailView;
  if (!j || typeof j !== "object" || !j.settings || !j.status) throw new Error("Unreadable mail settings answer");
  return j;
}

export type ReminderMailSaveResult = { ok: true; view: ReminderMailView } | { ok: false; message: string };

export async function saveReminderMail(body: ReminderMailSaveBody): Promise<ReminderMailSaveResult> {
  try {
    const r = await fetch(REMINDER_MAIL_API, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => null)) as (ReminderMailView & { message?: string }) | null;
    if (r.ok && j) return { ok: true, view: j };
    return { ok: false, message: j?.message || `Could not save (${r.status}).` };
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}

export type TestMailResult = { ok: true; message: string } | { ok: false; error: string };

export async function sendReminderTestMail(): Promise<TestMailResult> {
  try {
    const r = await fetch(`${REMINDER_MAIL_API}/test`, { method: "POST" });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string } | null;
    if (r.ok && j?.ok) return { ok: true, message: j.message || "Test mail sent." };
    return { ok: false, error: j?.error || `The test mail failed (${r.status}).` };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}
