/*
 * ledger.ts — the persisted "already mailed" ledger (repeat suppression).
 *
 * File: `<registryDir>/reminder-mail-ledger.json`, written under a
 * proper-lockfile lock after EVERY successful send so a restart never mails the
 * same thing again. Keys:
 *   reminder|<id>|<YYYY-MM-DD>   one mail per reminder per day
 *   triage|<project>|<id>|once   an expired parked triage item mails ONCE EVER
 *   summary||<YYYY-MM-DD>        the daily summary
 * Failures are counted per key and day (`tries`) so a dead SMTP server is tried
 * at most MAX_TRIES_PER_DAY times per item and day, never hammered. "Day" is the
 * SERVER-LOCAL calendar day (`localDay`), the same clock the summary time uses.
 */

import path from "node:path";

import { defaultLock, readJson, updateJson, type Lock } from "./json-store.js";

export const MAX_TRIES_PER_DAY = 3;
const KEEP_DAYS = 30;
const MAX_ONCE_KEYS = 5000;

interface LedgerFile {
  version: 1;
  /** key -> the day it was sent. */
  sent: Record<string, string>;
  /** key -> failed attempts on `day`. */
  tries: Record<string, { day: string; n: number }>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function normalize(raw: unknown): LedgerFile {
  const out: LedgerFile = { version: 1, sent: {}, tries: {} };
  if (!isRecord(raw)) return out;
  if (isRecord(raw.sent)) for (const [k, v] of Object.entries(raw.sent)) if (typeof v === "string" && DAY.test(v)) out.sent[k] = v;
  if (isRecord(raw.tries)) {
    for (const [k, v] of Object.entries(raw.tries)) {
      if (isRecord(v) && typeof v.day === "string" && DAY.test(v.day) && typeof v.n === "number" && v.n > 0) out.tries[k] = { day: v.day, n: Math.floor(v.n) };
    }
  }
  return out;
}

/** `scope` = the project id: triage ids are only unique inside one project's triage log. */
export const itemKey = (kind: string, id: string, day: string, scope = ""): string =>
  kind === "triage" ? `triage|${scope}|${id}|once` : `${kind}|${id}|${day}`;
export const summaryKey = (day: string): string => `summary||${day}`;

/** Local calendar day, `YYYY-MM-DD`. */
export function localDay(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export class MailLedger {
  constructor(private readonly dir: string, private readonly lock: Lock = defaultLock) {}

  private get file(): string {
    return path.join(this.dir, "reminder-mail-ledger.json");
  }

  private read(): LedgerFile {
    return readJson(this.file, normalize);
  }

  isSent(key: string): boolean {
    return key in this.read().sent;
  }

  /** True when this key already used its tries today. */
  exhausted(key: string, day: string): boolean {
    const t = this.read().tries[key];
    return t !== undefined && t.day === day && t.n >= MAX_TRIES_PER_DAY;
  }

  /**
   * Take the key BEFORE sending: true = this caller owns the send, false = it is already
   * sent (or being sent by another check or process). The claim is persisted under the lock,
   * so overlapping checks cannot both mail it, and a crash between the claim and the SMTP
   * answer loses that one mail (it stays in the Inbox) instead of repeating it after a restart.
   */
  async claim(key: string, day: string): Promise<boolean> {
    let won = false;
    await updateJson(this.file, normalize, (cur) => {
      if (key in cur.sent) return;
      won = true;
      cur.sent[key] = day;
      this.prune(cur, day);
    }, this.lock, { strict: true });
    return won;
  }

  /** The send failed: give the key back and count the try (at most MAX_TRIES_PER_DAY per day). */
  async failClaim(key: string, day: string): Promise<void> {
    await updateJson(this.file, normalize, (cur) => {
      delete cur.sent[key];
      const t = cur.tries[key];
      cur.tries[key] = t && t.day === day ? { day, n: t.n + 1 } : { day, n: 1 };
    }, this.lock, { strict: true });
  }

  private prune(cur: LedgerFile, today: string): void {
    const cutoff = new Date(`${today}T00:00:00`);
    cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
    const cut = localDay(cutoff);
    for (const [k, day] of Object.entries(cur.sent)) {
      if (!k.endsWith("|once") && day < cut) delete cur.sent[k];
    }
    for (const [k, t] of Object.entries(cur.tries)) if (t.day < cut) delete cur.tries[k];
    const once = Object.entries(cur.sent).filter(([k]) => k.endsWith("|once")).sort((a, b) => a[1].localeCompare(b[1]));
    for (const [k] of once.slice(0, Math.max(0, once.length - MAX_ONCE_KEYS))) delete cur.sent[k];
  }
}
