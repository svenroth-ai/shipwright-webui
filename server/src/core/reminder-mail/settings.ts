/*
 * settings.ts — reminder-mail settings (campaign reminders-webui, W4).
 *
 * Non-secret settings live in `<registryDir>/reminder-mail.json`. The SMTP
 * password lives ONLY in `<registryDir>/.env.local` (the central WebUI user
 * folder, outside every repo — CLAUDE.md DO-NOT #33 spirit): it is never in
 * the JSON file, never logged, never returned by any route (only a boolean
 * "is set"). Mail is OFF by default.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { defaultLock, readJson, updateJson, type Lock } from "./json-store.js";

export type MailFormat = "item" | "summary" | "both";
export type CheckInterval = "15m" | "1h" | "daily";

export interface ReminderMailSettings {
  enabled: boolean;
  recipient: string;
  format: MailFormat;
  /** Local "HH:MM". */
  summaryTime: string;
  summaryWhenEmpty: boolean;
  /** Origin only, e.g. `http://localhost:3847`; drives the links in the mail. */
  webuiAddress: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  checkInterval: CheckInterval;
}

export const DEFAULT_SETTINGS: ReminderMailSettings = {
  enabled: false,
  recipient: "",
  format: "both",
  summaryTime: "08:00",
  summaryWhenEmpty: false,
  webuiAddress: "",
  smtpHost: "",
  smtpPort: 587,
  smtpUser: "",
  checkInterval: "1h",
};

const FORMATS = ["item", "summary", "both"] as const;
const INTERVALS = ["15m", "1h", "daily"] as const;
const EMAIL = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]+$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const HOST = /^[A-Za-z0-9._:\-[\]]+$/;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function normalizeAddress(v: string): string | null {
  try {
    const u = new URL(v.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password || (u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Tolerant read-side normalizer: a hand-edited / corrupt file never crashes the timer. */
export function normalizeSettings(raw: unknown): ReminderMailSettings {
  const r = isRecord(raw) ? raw : {};
  const d = DEFAULT_SETTINGS;
  const str = (v: unknown, fb: string): string => (typeof v === "string" ? v : fb);
  const port = typeof r.smtpPort === "number" && Number.isInteger(r.smtpPort) && r.smtpPort > 0 && r.smtpPort < 65536 ? r.smtpPort : d.smtpPort;
  return {
    enabled: r.enabled === true,
    recipient: str(r.recipient, d.recipient),
    format: (FORMATS as readonly unknown[]).includes(r.format) ? (r.format as MailFormat) : d.format,
    summaryTime: typeof r.summaryTime === "string" && TIME.test(r.summaryTime) ? r.summaryTime : d.summaryTime,
    summaryWhenEmpty: r.summaryWhenEmpty === true,
    webuiAddress: normalizeAddress(str(r.webuiAddress, d.webuiAddress)) ?? "", // a hand-edited bad value = not set
    smtpHost: str(r.smtpHost, d.smtpHost),
    smtpPort: port,
    smtpUser: str(r.smtpUser, d.smtpUser),
    checkInterval: (INTERVALS as readonly unknown[]).includes(r.checkInterval) ? (r.checkInterval as CheckInterval) : d.checkInterval,
  };
}

export type PasswordUpdate = { kind: "keep" } | { kind: "set"; value: string } | { kind: "clear" };
export type SettingsParse =
  | { ok: true; settings: ReminderMailSettings; password: PasswordUpdate }
  | { ok: false; error: string };

export function missingForSending(s: ReminderMailSettings): string[] {
  const m: string[] = [];
  if (!s.recipient) m.push("recipient");
  if (!s.smtpHost) m.push("SMTP server");
  if (!s.webuiAddress) m.push("WebUI address");
  return m;
}

/** Strict parse of a PUT body. Unknown fields are ignored; bad values are named. */
export function parseSettingsBody(raw: unknown): SettingsParse {
  if (!isRecord(raw)) return { ok: false, error: "Body must be a JSON object." };
  const s = normalizeSettings(raw);
  if (typeof raw.enabled !== "boolean") return { ok: false, error: "enabled must be true or false." };
  if (raw.format !== undefined && !(FORMATS as readonly unknown[]).includes(raw.format)) return { ok: false, error: "Unknown mail format." };
  if (raw.checkInterval !== undefined && !(INTERVALS as readonly unknown[]).includes(raw.checkInterval)) return { ok: false, error: "Unknown check interval." };
  if (raw.summaryTime !== undefined && !(typeof raw.summaryTime === "string" && TIME.test(raw.summaryTime))) return { ok: false, error: "Summary time must look like 08:00." };
  if (raw.smtpPort !== undefined && s.smtpPort !== raw.smtpPort) return { ok: false, error: "Port must be a number between 1 and 65535." };
  const recipient = s.recipient.trim();
  if (recipient && !EMAIL.test(recipient)) return { ok: false, error: "Recipient must be one e-mail address." };
  const host = s.smtpHost.trim();
  if (host && (!HOST.test(host) || host.length > 255)) return { ok: false, error: "SMTP server must be a plain host name." };
  const user = s.smtpUser.trim();
  if (/[\r\n]/.test(user) || user.length > 255) return { ok: false, error: "User name is not valid." };
  let address = "";
  const rawAddress = typeof raw.webuiAddress === "string" ? raw.webuiAddress : "";
  if (rawAddress.trim()) {
    const a = normalizeAddress(rawAddress);
    if (!a) return { ok: false, error: "WebUI address must be only an address like http://localhost:3847 (no path)." };
    address = a;
  }
  const settings = { ...s, recipient, smtpHost: host, smtpUser: user, webuiAddress: address };
  const missing = missingForSending(settings);
  if (settings.enabled && missing.length > 0) return { ok: false, error: `To turn mail on, fill in: ${missing.join(", ")}.` };
  let password: PasswordUpdate = { kind: "keep" };
  if (raw.clearPassword === true) password = { kind: "clear" };
  else if (typeof raw.password === "string" && raw.password !== "") {
    if (raw.password.length > 512 || /[\r\n\0]/.test(raw.password)) return { ok: false, error: "Password is not valid." };
    password = { kind: "set", value: raw.password };
  }
  return { ok: true, settings, password };
}

export const settingsFile = (dir: string): string => path.join(dir, "reminder-mail.json");
export const envFile = (dir: string): string => path.join(dir, ".env.local");
export const loadSettings = (dir: string): ReminderMailSettings => readJson(settingsFile(dir), normalizeSettings);
export const saveSettings = (dir: string, s: ReminderMailSettings, lock: Lock = defaultLock): Promise<ReminderMailSettings> =>
  updateJson(settingsFile(dir), normalizeSettings, () => s, lock);

// ---- the secret: `.env.local` in the central user folder -----------------------------------

const PW_KEY = "SHIPWRIGHT_SMTP_PASSWORD";

/** True when `dir` (or an ancestor) is inside a git work tree: the secret must never go there. */
export function insideGitRepo(dir: string): boolean {
  let cur = path.resolve(dir);
  for (;;) {
    if (existsSync(path.join(cur, ".git"))) return true;
    const up = path.dirname(cur);
    if (up === cur) return false;
    cur = up;
  }
}

function readEnvLines(dir: string): string[] {
  try {
    return readFileSync(envFile(dir), "utf-8").split(/\r?\n/);
  } catch {
    return [];
  }
}

export function readSmtpPassword(dir: string): string | null {
  for (const line of readEnvLines(dir)) {
    if (!line.startsWith(`${PW_KEY}=`)) continue;
    try {
      const v: unknown = JSON.parse(line.slice(PW_KEY.length + 1));
      return typeof v === "string" && v !== "" ? v : null;
    } catch {
      return null;
    }
  }
  return null;
}

export const hasSmtpPassword = (dir: string): boolean => readSmtpPassword(dir) !== null;

/** Set (string) or remove (null) the password; other lines in the file are kept. */
export function writeSmtpPassword(dir: string, value: string | null): void {
  if (value !== null && insideGitRepo(dir)) {
    throw new Error("The WebUI user folder is inside a git repository; refusing to store the password there. Set SHIPWRIGHT_DATA_DIR to a folder outside every repo.");
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const rest = readEnvLines(dir).filter((l) => l !== "" && !l.startsWith(`${PW_KEY}=`));
  if (value !== null) rest.push(`${PW_KEY}=${JSON.stringify(value)}`);
  const tmp = `${envFile(dir)}.tmp-${process.pid}`;
  writeFileSync(tmp, rest.length ? `${rest.join("\n")}\n` : "", { mode: 0o600 });
  renameSync(tmp, envFile(dir));
}
