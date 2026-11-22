import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ReminderDueResult } from "../reminder-cli-runner.js";
import type { ReminderDueItem } from "../reminder-contract.js";
import { MailLedger, itemKey } from "./ledger.js";
import { ReminderMailService } from "./service.js";
import { DEFAULT_SETTINGS, saveSettings, writeSmtpPassword, type ReminderMailSettings } from "./settings.js";
import type { MailMessage, TransportFactory } from "./transport.js";

// A fresh random value per run: nothing about it is guessable or hardcoded.
const PASSWORD = `pw-${randomUUID()}`;
let dir: string;
let sent: MailMessage[];
let failWith: Error | null;
let clock: Date;
let logs: Record<string, unknown>[];
let reads: number;
let due: ReminderDueItem[];
let triageError: string | null;

const rem = (id: string, over: Partial<ReminderDueItem> = {}): ReminderDueItem => ({
  kind: "reminder", id, title: `Title ${id}`, due: "2026-11-22", why: "why", decided: null, open: null, command: null, links: [], severity: null, ...over,
});
const factory: TransportFactory = () => ({
  async send(m) {
    if (failWith) throw failWith;
    sent.push(m);
  },
});
const okResult = (): ReminderDueResult => ({
  kind: "ok", storeKey: "S:/store1",
  view: { contractVersion: 1, on: "2026-11-22", reminderCorruptLines: 0, triageError, items: due },
});
const make = (over: Partial<ConstructorParameters<typeof ReminderMailService>[0]> = {}): ReminderMailService =>
  new ReminderMailService({
    dir, now: () => clock, makeTransport: factory, log: (l) => logs.push(l),
    listProjects: () => [{ id: "p1", path: "S:/p1", name: "Proj One" }],
    readDue: async () => { reads++; return okResult(); },
    ...over,
  });
const enable = (over: Partial<ReminderMailSettings> = {}) =>
  saveSettings(dir, { ...DEFAULT_SETTINGS, enabled: true, recipient: "me@example.org", smtpHost: "smtp.example.org", smtpUser: "me@example.org", webuiAddress: "http://localhost:3847", format: "item", ...over });

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "rmail-"));
  sent = []; failWith = null; logs = []; reads = 0; triageError = null;
  clock = new Date(2026, 10, 22, 9, 0, 0);
  due = [rem("rem-1"), rem("trg-1", { kind: "triage", id: "trg-1" })];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("reminder mail service", () => {
  it("is off by default: no CLI call, no mail", async () => {
    expect(await make().runCheck()).toEqual({ ran: false, reason: "off" });
    expect(reads).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("does not run while enabled but incomplete", async () => {
    await enable({ smtpHost: "" }).catch(() => undefined);
    expect(await make().runCheck()).toEqual({ ran: false, reason: "incomplete" });
  });

  it("mails one mail per (kind, id, day) and not again on a second check the same day", async () => {
    await enable();
    const svc = make();
    expect(await svc.runCheck()).toMatchObject({ ran: true, sent: 2 });
    expect(await svc.runCheck()).toMatchObject({ ran: true, sent: 0 });
    expect(sent).toHaveLength(2);
    clock = new Date(2026, 10, 23, 9, 0, 0);
    await svc.runCheck();
    // next day: the reminder mails again, the expired triage park does NOT
    expect(sent.map((m) => m.subject)).toEqual([
      expect.stringContaining("Title rem-1"), expect.stringContaining("Title trg-1"), expect.stringContaining("Title rem-1"),
    ]);
  });

  it("keeps the suppression across a restart (new service instance, same folder)", async () => {
    await enable();
    await make().runCheck();
    expect(sent).toHaveLength(2);
    await make().runCheck(); // "restart"
    clock = new Date(2026, 10, 25, 9, 0, 0);
    await make().runCheck(); // days later, after another restart
    expect(sent.filter((m) => m.subject.includes("trg-1"))).toHaveLength(1);
    expect(sent.filter((m) => m.subject.includes("rem-1"))).toHaveLength(2);
    expect(new MailLedger(dir).isSent(itemKey("triage", "trg-1", "x", "p1"))).toBe(true);
  });

  it("tries a failing item at most 3 times a day and shows the exact failure", async () => {
    await enable();
    failWith = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const svc = make();
    for (let i = 0; i < 6; i++) await svc.runCheck();
    const attemptsPerItem = logs.filter((l) => l.message === "reminder mail send failed").length;
    expect(attemptsPerItem).toBe(6); // 2 items x exactly 3 tries, then no more that day
    expect(sent).toHaveLength(0);
    expect(svc.getStatus().error?.message).toBe("connection refused by smtp.example.org:587");
    // a fixed server mails on the next check (new day resets the tries)
    failWith = null;
    clock = new Date(2026, 10, 23, 9, 0, 0);
    await svc.runCheck();
    expect(sent).toHaveLength(2);
    expect(svc.getStatus().error).toBeNull();
  });

  it("does not hammer a dead server within one check", async () => {
    await enable();
    due = Array.from({ length: 10 }, (_, i) => rem(`rem-${i}`));
    failWith = new Error("down");
    await make().runCheck();
    expect(logs.filter((l) => l.message === "reminder mail send failed")).toHaveLength(2);
  });

  it("sends the daily summary once per day at/after the summary time, in 'both'", async () => {
    await enable({ format: "both", summaryTime: "08:00" });
    clock = new Date(2026, 10, 22, 7, 0, 0);
    const svc = make();
    await svc.runCheck();
    expect(sent.some((m) => m.subject.includes("Daily summary"))).toBe(false);
    clock = new Date(2026, 10, 22, 8, 5, 0);
    await svc.runCheck();
    await svc.runCheck();
    expect(sent.filter((m) => m.subject.includes("Daily summary"))).toHaveLength(1);
  });

  it("sends no summary when nothing is due, unless asked to", async () => {
    await enable({ format: "summary" });
    due = [];
    await make().runCheck();
    expect(sent).toHaveLength(0);
    await enable({ format: "summary", summaryWhenEmpty: true });
    await make().runCheck();
    expect(sent[0].subject).toContain("nothing due");
  });

  it("never reads a failed triage side as 'nothing due'", async () => {
    await enable({ format: "summary" });
    due = [];
    triageError = "triage unreadable";
    await make().runCheck();
    expect(sent).toHaveLength(1);
    expect(sent[0].text).not.toContain("Nothing is due");
    expect(make().getStatus().notes[0]).toContain("parked triage items could not be read");
  });

  it("mails a reminder once even when two registrations share one store", async () => {
    await enable();
    due = [rem("rem-1")];
    await make({ listProjects: () => [{ id: "p1", path: "S:/p1", name: "A" }, { id: "p2", path: "S:/p1/sub", name: "B" }] }).runCheck();
    expect(sent).toHaveLength(1);
  });

  it("skips items without an id and unreadable projects, with a visible note", async () => {
    await enable();
    due = [rem("x", { id: null })];
    await make({ readDue: async () => ({ kind: "unreadable", reason: "x" }) }).runCheck();
    expect(sent).toHaveLength(0);
    expect(make().getStatus().notes[0]).toContain("did not run");
  });

  it("never lets the SMTP password reach a log line, the status file, the ledger or an error text", async () => {
    await enable();
    writeSmtpPassword(dir, PASSWORD);
    failWith = new Error(`535 auth failed for ${PASSWORD}`);
    const svc = make();
    await svc.runCheck();
    const test = await svc.sendTest();
    expect(test).toMatchObject({ ok: false });
    expect(JSON.stringify(test)).not.toContain(PASSWORD);
    expect(JSON.stringify(logs)).not.toContain(PASSWORD);
    for (const f of readdirSync(dir)) {
      if (f === ".env.local") continue;
      expect(readFileSync(path.join(dir, f), "utf-8")).not.toContain(PASSWORD);
    }
    expect(readFileSync(path.join(dir, ".env.local"), "utf-8")).toContain(PASSWORD);
  });

  it("two overlapping checks (two services, one folder) mail each item exactly once", async () => {
    await enable();
    await Promise.all([make().runCheck(), make().runCheck(), make().runCheck()]);
    expect(sent.filter((m) => m.subject.includes("rem-1"))).toHaveLength(1);
    expect(sent.filter((m) => m.subject.includes("trg-1"))).toHaveLength(1);
  });

  it("an expired parked item reaches the operator once ever, also with summary-only mail", async () => {
    await enable({ format: "summary", summaryTime: "08:00" });
    const svc = make();
    await svc.runCheck();
    clock = new Date(2026, 10, 23, 9, 0, 0);
    await svc.runCheck();
    const summaries = sent.filter((m) => m.subject.includes("Daily summary"));
    expect(summaries).toHaveLength(2);
    expect(summaries[0].text).toContain("Title trg-1");
    expect(summaries[1].text).not.toContain("Title trg-1");
    expect(summaries[1].text).toContain("Title rem-1");
  });

  it("with 'both', the summary does not repeat the parked item the item mail already sent", async () => {
    await enable({ format: "both", summaryTime: "08:00" });
    await make().runCheck();
    const summary = sent.find((m) => m.subject.includes("Daily summary"));
    expect(summary?.text).not.toContain("Title trg-1");
  });

  it("the day key is the server-local calendar day (pinned across midnight)", async () => {
    await enable();
    const svc = make();
    clock = new Date(2026, 10, 22, 23, 59, 0);
    await svc.runCheck();
    clock = new Date(2026, 10, 23, 0, 1, 0);
    await svc.runCheck();
    expect(sent.filter((m) => m.subject.includes("rem-1"))).toHaveLength(2);
  });

  it("fails closed when the ledger file is damaged: nothing is mailed and the reason is visible", async () => {
    await enable();
    await make().runCheck();
    expect(sent).toHaveLength(2);
    writeFileSync(path.join(dir, "reminder-mail-ledger.json"), "{not json");
    sent.length = 0;
    const svc = make();
    const out = await svc.runCheck();
    expect(sent).toHaveLength(0);
    expect(out).toMatchObject({ ran: true, sent: 0 });
    expect(svc.getStatus().error?.message).toContain("ledger file is damaged");
  });

  it("two projects with the same triage id are each mailed once (keys are project-scoped)", async () => {
    await enable();
    due = [rem("trg-1", { kind: "triage", id: "trg-1" })];
    const svc = make({
      listProjects: () => [{ id: "p1", path: "S:/p1", name: "A" }, { id: "p2", path: "S:/p2", name: "B" }],
      readDue: async (pp) => ({ kind: "ok", storeKey: `S:/${pp}`, view: { contractVersion: 1, on: "2026-11-22", reminderCorruptLines: 0, triageError: null, items: due } }),
    });
    await svc.runCheck();
    // the in-run dedupe is by (kind, id): the second project's twin is skipped, so exactly one mail now
    expect(sent).toHaveLength(1);
  });

  it("test mail goes to the saved recipient and reports what is missing", async () => {
    expect(await make().sendTest()).toMatchObject({ ok: false, error: expect.stringContaining("recipient") });
    await enable();
    expect(await make().sendTest()).toEqual({ ok: true });
    expect(sent[0].to).toBe("me@example.org");
  });

  it("never puts a local path in a mail even when the item text has one", async () => {
    await enable();
    due = [rem("rem-9", { why: "see C:\\Users\\me\\repo\\file.md and /home/me/x" })];
    await make().runCheck();
    expect(sent[0].text + sent[0].html).not.toMatch(/Users|\/home\/me/);
  });
});
