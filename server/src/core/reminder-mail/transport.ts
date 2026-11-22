/*
 * transport.ts — the one SMTP seam (nodemailer, exact-pinned; the ONLY mail
 * dependency, see the W4 ADR). Everything above this file talks to the
 * `MailTransport` interface, so tests inject a fake and never send real mail.
 *
 * The password is handed to nodemailer and nowhere else. Failure text is
 * produced by `describeSendError`, which scrubs the password (a hostile or
 * chatty server could echo it) and flattens newlines before it can reach a
 * log line, the status file or an API answer.
 */

import nodemailer from "nodemailer";

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Inline (CID) attachments, e.g. the logo. */
  attachments?: { filename: string; content: Buffer; cid: string; contentType: string; contentDisposition: "inline" }[];
}

export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string | null;
}

export type TransportFactory = (cfg: SmtpConfig) => MailTransport;

const isLoopback = (h: string): boolean => h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";

export const nodemailerTransport: TransportFactory = (cfg) => {
  const secure = cfg.port === 465;
  const t = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure,
    // STARTTLS is mandatory on submission ports unless the relay is this machine itself.
    requireTLS: !secure && !isLoopback(cfg.host),
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? "" } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    async send(m) {
      try {
        await t.sendMail(m);
      } finally {
        t.close();
      }
    },
  };
};

/** Every spelling of the password a chatty server or library could echo back. */
function secretForms(pass: string, user?: string): string[] {
  const b64 = (s: string): string => Buffer.from(s, "utf-8").toString("base64");
  const forms = [pass, encodeURIComponent(pass), b64(pass), b64(`\0${user ?? ""}\0${pass}`), b64(`${user ?? ""}:${pass}`)];
  // The literal password is ALWAYS scrubbed, however short; the derived spellings only when long
  // enough not to mangle ordinary words.
  return [...new Set(forms)].filter((f) => f === pass || f.length >= 3).sort((x, y) => y.length - x.length);
}

function scrub(msg: string, cfg: { pass: string | null; user?: string }): string {
  let out = msg.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, "$1***@"); // credentials inside a URL
  if (cfg.pass) for (const f of secretForms(cfg.pass, cfg.user)) out = out.split(f).join("***");
  return out;
}

/** One short, single-line, secret-free description of a failed send. */
export function describeSendError(err: unknown, cfg: Pick<SmtpConfig, "host" | "port" | "pass"> & { user?: string }): string {
  const e = (typeof err === "object" && err !== null ? err : {}) as { code?: unknown; message?: unknown; responseCode?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const where = `${cfg.host}:${cfg.port}`;
  let msg = typeof e.message === "string" && e.message ? e.message : String(err);
  if (code === "ECONNREFUSED" || /ECONNREFUSED/.test(msg)) msg = `connection refused by ${where}`;
  else if (code === "ENOTFOUND" || code === "EDNS") msg = `server name not found: ${cfg.host}`;
  else if (code === "ETIMEDOUT" || code === "ESOCKET" || code === "ECONNECTION") msg = `could not reach ${where} (${msg})`;
  msg = scrub(msg, cfg);
  msg = msg.replace(/\s+/g, " ").trim();
  return msg.length > 300 ? `${msg.slice(0, 300)}...` : msg;
}
