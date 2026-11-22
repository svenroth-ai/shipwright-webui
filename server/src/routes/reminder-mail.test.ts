import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ReminderMailService } from "../core/reminder-mail/service.js";
import type { MailMessage } from "../core/reminder-mail/transport.js";
import { createReminderMailRoutes } from "./reminder-mail.js";

const PW = `pw-${randomUUID()}`;
let dir: string;
let sent: MailMessage[];
let failWith: Error | null;
let logs: string[];
let now: number;

function app() {
  const service = new ReminderMailService({
    dir, listProjects: () => [], readDue: async () => ({ kind: "failed", reason: "x" }), log: (l) => logs.push(JSON.stringify(l)),
    makeTransport: () => ({ async send(m) { if (failWith) throw failWith; sent.push(m); } }),
  });
  return createReminderMailRoutes({ dir, service, now: () => now });
}
const put = (a: ReturnType<typeof app>, b: Record<string, unknown>, headers: Record<string, string> = { "content-type": "application/json" }) =>
  a.request("/api/reminder-mail", { method: "PUT", headers, body: JSON.stringify(b) });
const settings = (o: Record<string, unknown> = {}) => ({
  enabled: true, recipient: "me@example.org", format: "item", summaryTime: "08:00", summaryWhenEmpty: false,
  webuiAddress: "http://localhost:3847", smtpHost: "smtp.example.org", smtpPort: 587, smtpUser: "me@example.org", checkInterval: "1h", ...o,
});

beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), "rmail-rt-")); sent = []; failWith = null; logs = []; now = 1_000_000; });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("reminder-mail routes", () => {
  it("starts off with no password set", async () => {
    const j = await (await app().request("/api/reminder-mail")).json();
    expect(j.settings.enabled).toBe(false);
    expect(j.passwordSet).toBe(false);
  });

  it("saves, reports only 'password set', and never returns the password anywhere", async () => {
    const a = app();
    const res = await put(a, settings({ password: PW }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(PW);
    expect(JSON.parse(text).passwordSet).toBe(true);
    const get = await (await a.request("/api/reminder-mail")).text();
    expect(get).not.toContain(PW);
    // the password sits ONLY in .env.local
    for (const f of readdirSync(dir)) {
      const content = readFileSync(path.join(dir, f), "utf-8");
      expect(content.includes(PW)).toBe(f === ".env.local");
    }
  });

  it("keeps the password when a later save omits it, and clears it on request", async () => {
    const a = app();
    await put(a, settings({ password: PW }));
    expect((await (await put(a, settings({ recipient: "x@example.org" }))).json()).passwordSet).toBe(true);
    expect((await (await put(a, settings({ clearPassword: true }))).json()).passwordSet).toBe(false);
  });

  it("a changed SMTP server needs the password typed again (it never follows to a new host)", async () => {
    const a = app();
    await put(a, settings({ password: PW }));
    const res = await put(a, settings({ smtpHost: "evil.example.net" }));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("Enter the password again");
    expect((await put(a, settings({ smtpHost: "evil.example.net", password: PW }))).status).toBe(200);
    expect((await put(a, settings({ smtpHost: "other.example.net", clearPassword: true }))).status).toBe(200);
  });

  it("a failed password write changes nothing: the old host stays with the old password", async () => {
    const a = app();
    await put(a, settings({ password: PW }));
    const gitDir = path.join(dir, ".git");
    (await import("node:fs")).mkdirSync(gitDir); // the data folder now looks like a repo: storing a password is refused
    const res = await put(a, settings({ smtpHost: "new.example.net", password: PW }));
    expect(res.status).toBe(500);
    const j = await (await a.request("/api/reminder-mail")).json();
    expect(j.settings.smtpHost).toBe("smtp.example.org");
  });

  it("rejects a host with a port in it", async () => {
    const res = await put(app(), settings({ smtpHost: "smtp.example.org:2525" }));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("Port field");
  });

  it("rejects invalid input with a plain message", async () => {
    const res = await put(app(), settings({ smtpPort: 0 }));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("Port");
  });

  it("refuses a non-JSON write (cross-site simple POST) and a cross-site GET", async () => {
    const a = app();
    expect((await put(a, settings(), { "content-type": "text/plain" })).status).toBe(415);
    expect((await a.request("/api/reminder-mail", { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    expect((await a.request("/api/reminder-mail/test", { method: "POST", headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
  });

  it("test mail: sends to the saved recipient", async () => {
    const a = app();
    await put(a, settings());
    const res = await a.request("/api/reminder-mail/test", { method: "POST" });
    expect(await res.json()).toEqual({ ok: true, message: "Test mail sent." });
    expect(sent[0].to).toBe("me@example.org");
  });

  it("test mail: shows the exact failure, scrubbed of the password, and logs nothing secret", async () => {
    const a = app();
    await put(a, settings({ password: PW }));
    failWith = Object.assign(new Error(`535 5.7.8 bad credentials ${PW}`), { code: "EAUTH" });
    const res = await a.request("/api/reminder-mail/test", { method: "POST" });
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(text).toContain("535 5.7.8 bad credentials");
    expect(text).not.toContain(PW);
    expect(logs.join("")).not.toContain(PW);
  });

  it("test mail: connection refused is reported in plain words", async () => {
    const a = app();
    await put(a, settings());
    failWith = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:587"), { code: "ECONNREFUSED" });
    expect((await (await a.request("/api/reminder-mail/test", { method: "POST" })).json()).error).toBe("connection refused by smtp.example.org:587");
  });

  it("test mail is rate limited", async () => {
    const a = app();
    await put(a, settings());
    await a.request("/api/reminder-mail/test", { method: "POST" });
    expect((await a.request("/api/reminder-mail/test", { method: "POST" })).status).toBe(429);
    now += 5000;
    expect((await a.request("/api/reminder-mail/test", { method: "POST" })).status).toBe(200);
  });
});
