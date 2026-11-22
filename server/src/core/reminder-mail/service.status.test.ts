import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ReminderDueResult } from "../reminder-cli-runner.js";
import type { ReminderDueItem } from "../reminder-contract.js";
import { defaultLock } from "./json-store.js";
import { ReminderMailService } from "./service.js";
import { DEFAULT_SETTINGS, saveSettings, type ReminderMailSettings } from "./settings.js";
import type { MailMessage } from "./transport.js";

let dir: string;
let sent: MailMessage[];
let failWith: Error | null;
let due: ReminderDueItem[];
const rem = (id: string): ReminderDueItem => ({
  kind: "reminder", id, title: `Title ${id}`, due: "2026-11-22", why: "why", decided: null, open: null, command: null, links: [], severity: null,
});
const okResult = (): ReminderDueResult => ({
  kind: "ok", storeKey: "S:/store1",
  view: { contractVersion: 1, on: "2026-11-22", reminderCorruptLines: 0, triageError: null, items: due },
});
const make = (over: Partial<ConstructorParameters<typeof ReminderMailService>[0]> = {}): ReminderMailService =>
  new ReminderMailService({
    dir, now: () => new Date(2026, 10, 22, 9, 0, 0), log: () => undefined,
    makeTransport: () => ({ async send(m) { if (failWith) throw failWith; sent.push(m); } }),
    listProjects: () => [{ id: "p1", path: "S:/p1", name: "Proj One" }],
    readDue: async () => okResult(),
    ...over,
  });
const enable = (over: Partial<ReminderMailSettings> = {}) =>
  saveSettings(dir, { ...DEFAULT_SETTINGS, enabled: true, recipient: "me@example.org", smtpHost: "smtp.example.org", smtpUser: "me@example.org", webuiAddress: "http://localhost:3847", format: "item", ...over });

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "rmail2-"));
  sent = []; failWith = null; due = [rem("rem-1")];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// @covers FR-01.77
describe("reminder mail service - ledger and status", () => {
  it("a good test mail clears the failed-send error", async () => {
    await enable();
    failWith = new Error("down");
    const svc = make();
    await svc.runCheck();
    expect(svc.getStatus().error).not.toBeNull();
    failWith = null;
    expect(await svc.sendTest()).toEqual({ ok: true });
    expect(svc.getStatus().error).toBeNull();
    await svc.runCheck(); // today's used-up tries were reset, so the item is retried right away
    expect(sent.length).toBeGreaterThan(1);
  });

  it("a busy (locked) ledger is reported without the delete-the-file advice", async () => {
    await enable();
    const svc = make({ lock: async (f: string) => { if (!f.includes("ledger")) return defaultLock(f); throw Object.assign(new Error("Lock file is already being held"), { code: "ELOCKED" }); } });
    await svc.runCheck();
    expect(sent).toHaveLength(0);
    const m = svc.getStatus().error?.message ?? "";
    expect(m).toContain("busy");
    expect(m).not.toContain("Delete");
  });

  it("a failed mail that cannot be given back is reported, not swallowed", async () => {
    await enable();
    failWith = new Error("down");
    let ledgerLocks = 0;
    const svc = make({ lock: async (f: string) => { if (!f.includes("ledger") || ++ledgerLocks === 1) return defaultLock(f); throw new Error("disk trouble"); } });
    await svc.runCheck();
    expect(svc.getStatus().error?.message).toContain("could not be given back");
  });

  it("a failed summary stays visible in 'both' even when the item mails went out", async () => {
    await enable({ format: "both", summaryTime: "08:00" });
    due = [rem("rem-1")];
    let calls = 0;
    const flaky = make({
      makeTransport: () => ({ async send(m) { calls++; if (m.subject.includes("Daily summary")) throw new Error("summary refused"); sent.push(m); } }),
    });
    for (let i = 0; i < 4; i++) await flaky.runCheck();
    expect(calls).toBeGreaterThan(0);
    expect(flaky.getStatus().error?.message).toContain("summary refused");
  });
});
