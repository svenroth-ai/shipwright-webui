/*
 * service.ts — one reminder-mail check (campaign reminders-webui, W4).
 *
 * `runCheck()` reads `due` for every registered project (through the W1 CLI
 * bridge: the WebUI never reads or writes reminders.jsonl), mails what is new
 * per the settings and records every outcome. Rules:
 *   - mail is OFF by default; off means NO CLI call and NO mail;
 *   - one mail per (kind, id, day); an expired parked triage item mails ONCE
 *     EVER; the ledger survives restarts (ledger.ts);
 *   - a failed send is shown in Settings (status) and retried at the next check,
 *     at most MAX_TRIES_PER_DAY times per item and day;
 *   - a project that could not be read is a visible note, never "nothing due".
 * Secrets: the password is read from `.env.local`, passed to the transport only,
 * and scrubbed from every error text that is stored or logged.
 */

import path from "node:path";

import type { ReminderDueResult } from "../reminder-cli-runner.js";
import { MAX_SUMMARY_ITEMS, composeItemMail, composeSummaryMail, composeTestMail, type ComposedMail, type MailEntry } from "./compose.js";
import { DamagedStateError, defaultLock, readJson, updateJson, type Lock } from "./json-store.js";
import { MailLedger, itemKey, localDay, summaryKey } from "./ledger.js";
import { EMAIL, loadSettings, missingForSending, readSmtpPassword, type ReminderMailSettings } from "./settings.js";
import { logoAttachment } from "./logo.js";
import { describeSendError, type MailMessage, type SmtpConfig, type TransportFactory } from "./transport.js";

const MAX_MAILS_PER_CHECK = 25;
const MAX_CONSECUTIVE_FAILURES = 2;

export interface ProjectRef {
  id: string;
  path: string;
  name?: string;
  synthesized?: boolean;
}

export interface MailStatus {
  lastCheckAt: string | null;
  lastSent: number;
  /** Set while the last send failed; cleared by the next fully good check. */
  error: { at: string; message: string; recipient: string } | null;
  /** Projects the last check could not read (named states only, no paths). */
  notes: string[];
}

const EMPTY_STATUS: MailStatus = { lastCheckAt: null, lastSent: 0, error: null, notes: [] };

function normalizeStatus(raw: unknown): MailStatus {
  if (typeof raw !== "object" || raw === null) return { ...EMPTY_STATUS };
  const r = raw as Record<string, unknown>;
  const e = r.error as Record<string, unknown> | null | undefined;
  return {
    lastCheckAt: typeof r.lastCheckAt === "string" ? r.lastCheckAt : null,
    lastSent: typeof r.lastSent === "number" ? r.lastSent : 0,
    error: e && typeof e.at === "string" && typeof e.message === "string" && typeof e.recipient === "string" ? { at: e.at, message: e.message, recipient: e.recipient } : null,
    notes: Array.isArray(r.notes) ? r.notes.filter((n): n is string => typeof n === "string").slice(0, 20) : [],
  };
}

export interface MailServiceDeps {
  /** The central WebUI user folder (`registryDir`). */
  dir: string;
  listProjects: () => ProjectRef[];
  readDue: (projectPath: string) => Promise<ReminderDueResult>;
  makeTransport: TransportFactory;
  now?: () => Date;
  lock?: Lock;
  log?: (line: Record<string, unknown>) => void;
}

export type CheckOutcome =
  | { ran: false; reason: "off" | "incomplete" | "busy" }
  | { ran: true; sent: number; failed: number };

const hhmm = (d: Date): string => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const normStore = (k: string): string => (process.platform === "win32" ? k.toLowerCase().replaceAll("\\", "/") : k);

export class ReminderMailService {
  private busy = false;
  private readonly now: () => Date;
  private readonly lock: Lock;
  private readonly ledger: MailLedger;

  constructor(private readonly deps: MailServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.lock = deps.lock ?? defaultLock;
    this.ledger = new MailLedger(deps.dir, this.lock);
  }

  private get statusFile(): string {
    return path.join(this.deps.dir, "reminder-mail-status.json");
  }

  getStatus(): MailStatus {
    return readJson(this.statusFile, normalizeStatus);
  }

  private async setStatus(fn: (s: MailStatus) => void): Promise<void> {
    await updateJson(this.statusFile, normalizeStatus, (s) => void fn(s), this.lock).catch(() => undefined);
  }

  private smtp(s: ReminderMailSettings): SmtpConfig {
    return { host: s.smtpHost, port: s.smtpPort, user: s.smtpUser, pass: readSmtpPassword(this.deps.dir) };
  }

  /** `Shipwright Command Center <address>` (mockup page 05); the address is the user name when it is one, else the recipient. */
  private from(s: ReminderMailSettings): string {
    const addr = EMAIL.test(s.smtpUser) ? s.smtpUser : s.recipient;
    return `Shipwright Command Center <${addr}>`;
  }

  private message(s: ReminderMailSettings, mail: ComposedMail): MailMessage {
    return { from: this.from(s), to: s.recipient, ...mail, attachments: logoAttachment() };
  }

  async clearError(): Promise<void> {
    await this.setStatus((s) => {
      s.error = null;
    });
  }

  /** The "Send test mail" button: one fixed sample mail to the saved recipient. */
  async sendTest(): Promise<{ ok: true } | { ok: false; error: string }> {
    const s = loadSettings(this.deps.dir);
    const missing = missingForSending(s);
    if (missing.length > 0) return { ok: false, error: `Not set up yet: fill in ${missing.join(", ")} and save.` };
    const cfg = this.smtp(s);
    try {
      const mail = composeTestMail(s.webuiAddress);
      await this.deps.makeTransport(cfg).send(this.message(s, mail));
      await this.clearError(); // the operator just proved the settings work
      return { ok: true };
    } catch (err) {
      return { ok: false, error: describeSendError(err, cfg) };
    }
  }

  async runCheck(): Promise<CheckOutcome> {
    if (this.busy) return { ran: false, reason: "busy" };
    const s = loadSettings(this.deps.dir);
    if (!s.enabled) return { ran: false, reason: "off" };
    if (missingForSending(s).length > 0) return { ran: false, reason: "incomplete" };
    this.busy = true;
    try {
      return await this.check(s);
    } finally {
      this.busy = false;
    }
  }

  private async collect(): Promise<{ entries: MailEntry[]; notes: string[] }> {
    const entries: MailEntry[] = [];
    const notes: string[] = [];
    const storeOwner = new Set<string>();
    const seen = new Set<string>();
    for (const p of this.deps.listProjects().filter((x) => !x.synthesized)) {
      const label = p.name || p.id;
      let r: ReminderDueResult;
      try {
        r = await this.deps.readDue(p.path);
      } catch {
        notes.push(`${label}: the reminder check failed unexpectedly.`);
        continue;
      }
      if (r.kind !== "ok") {
        notes.push(`${label}: the reminder check did not run (${r.kind}).`);
        continue;
      }
      if (r.view.triageError !== null) notes.push(`${label}: parked triage items could not be read.`);
      if (r.view.reminderCorruptLines > 0) notes.push(`${label}: some stored reminders could not be read.`);
      // Registrations that reach ONE store list the same reminders: keep them once.
      let sharedStore = false;
      if (r.storeKey) {
        const k = normStore(r.storeKey);
        sharedStore = storeOwner.has(k);
        storeOwner.add(k);
      }
      for (const item of r.view.items) {
        if (sharedStore && item.kind === "reminder") continue;
        if (typeof item.id !== "string" || item.id === "" || item.id.length > 200) continue;
        // triage ids are only unique inside one project's log; a reminder is one store-wide entry
        const dedupe = item.kind === "triage" ? `triage|${p.id}|${item.id}` : `reminder|${item.id}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        entries.push({ item, projectName: label, projectId: p.id });
      }
    }
    return { entries, notes };
  }

  private async check(s: ReminderMailSettings): Promise<CheckOutcome> {
    const now = this.now();
    const day = localDay(now);
    const cfg = this.smtp(s);
    const transport = this.deps.makeTransport(cfg);
    const { entries, notes } = await this.collect();
    let sent = 0;
    let failed = 0;
    let consecutive = 0;
    let firstError: string | null = null;

    let stop = false; // the ledger cannot be trusted: send nothing more this check
    const attempt = async (key: string, mail: ComposedMail): Promise<boolean> => {
      try {
        if (!(await this.ledger.claim(key, day))) return false; // already mailed (or taken by another check)
      } catch (err) {
        // Fail closed: a damaged or locked ledger must never turn into a mail storm.
        stop = true;
        firstError ??= err instanceof DamagedStateError
          ? "Could not record what was mailed (the mail ledger file is damaged), so nothing was sent. Delete reminder-mail-ledger.json in the WebUI user folder to resume; mail may then repeat once."
          : "Could not record what was mailed (the mail ledger is busy), so nothing was sent. The next check tries again.";
        failed++;
        return false;
      }
      try {
        await transport.send(this.message(s, mail));
        sent++;
        consecutive = 0;
        return true;
      } catch (err) {
        await this.ledger.failClaim(key, day).catch(() => undefined);
        failed++;
        consecutive++;
        const why = describeSendError(err, cfg);
        firstError ??= why;
        this.deps.log?.({ level: "warn", message: "reminder mail send failed", error: why });
        return false;
      }
    };

    if (s.format !== "summary") {
      for (const e of entries) {
        if (stop || sent + failed >= MAX_MAILS_PER_CHECK || consecutive >= MAX_CONSECUTIVE_FAILURES) break;
        const key = itemKey(e.item.kind, e.item.id as string, day, e.projectId);
        if (this.ledger.isSent(key) || this.ledger.exhausted(key, day)) continue;
        await attempt(key, composeItemMail(e, s.webuiAddress));
      }
    }

    if (s.format !== "item" && hhmm(now) >= s.summaryTime && !stop && consecutive < MAX_CONSECUTIVE_FAILURES) {
      const key = summaryKey(day);
      // An expired parked item is mailed ONCE EVER, in either format: the summary lists only the
      // ones that have not been mailed yet (in "both" the per-item mail already took them).
      const listed = entries.filter((e) => e.item.kind !== "triage" || !this.ledger.isSent(itemKey("triage", e.item.id as string, day, e.projectId)));
      if (!this.ledger.isSent(key) && !this.ledger.exhausted(key, day) && (listed.length > 0 || s.summaryWhenEmpty || notes.length > 0)) {
        // Only what the mail really shows is marked as mailed; the rest stays eligible for the next summary.
        const shown = listed.slice(0, MAX_SUMMARY_ITEMS);
        if (await attempt(key, composeSummaryMail(shown, { address: s.webuiAddress, day, problems: notes, more: listed.length - shown.length }))) {
          for (const e of shown) if (e.item.kind === "triage") await this.ledger.claim(itemKey("triage", e.item.id as string, day, e.projectId), day).catch(() => false);
        }
      }
    }

    const at = now.toISOString();
    await this.setStatus((st) => {
      st.lastCheckAt = at;
      st.lastSent = sent;
      st.notes = notes;
      if (firstError !== null) st.error = { at, message: firstError, recipient: s.recipient };
      else if (failed === 0 && !this.hasExhausted(entries, day, s)) st.error = null;
    });
    return { ran: true, sent, failed };
  }

  /** Items that used up their tries today keep the error visible even on a quiet check. */
  private hasExhausted(entries: MailEntry[], day: string, s: ReminderMailSettings): boolean {
    if (s.format !== "item" && this.ledger.exhausted(summaryKey(day), day)) return true;
    if (s.format === "summary") return false;
    return entries.some((e) => this.ledger.exhausted(itemKey(e.item.kind, e.item.id as string, day, e.projectId), day));
  }
}
