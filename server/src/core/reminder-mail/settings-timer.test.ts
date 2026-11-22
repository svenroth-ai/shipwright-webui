import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startReminderMailTimer } from "./timer.js";
import {
  DEFAULT_SETTINGS, envFile, hasSmtpPassword, insideGitRepo, loadSettings, parseSettingsBody,
  readSmtpPassword, saveSettings, settingsFile, writeSmtpPassword,
} from "./settings.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), "rmail-set-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const body = (o: Record<string, unknown> = {}) => ({ ...DEFAULT_SETTINGS, ...o });

describe("settings", () => {
  it("is off by default", () => {
    expect(loadSettings(dir).enabled).toBe(false);
  });

  it("round-trips and survives a corrupt file", async () => {
    await saveSettings(dir, { ...DEFAULT_SETTINGS, recipient: "a@b.co" });
    expect(loadSettings(dir).recipient).toBe("a@b.co");
    mkdirSync(dir, { recursive: true });
    await import("node:fs").then((fs) => fs.writeFileSync(settingsFile(dir), "{not json"));
    expect(loadSettings(dir)).toEqual(DEFAULT_SETTINGS);
  });

  it("refuses to turn mail on while recipient, server or address is missing", () => {
    const r = parseSettingsBody(body({ enabled: true }));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("recipient") });
  });

  it.each([
    [{ recipient: "a@b.co, c@d.co" }, "Recipient"],
    [{ recipient: "a@b.co\r\nBcc: x@y.z" }, "Recipient"],
    [{ smtpPort: 70000 }, "Port"],
    [{ smtpPort: "587" }, "Port"],
    [{ webuiAddress: "javascript:alert(1)" }, "address"],
    [{ webuiAddress: "http://host/inbox" }, "address"],
    [{ summaryTime: "25:00" }, "Summary time"],
    [{ format: "all" }, "format"],
    [{ smtpHost: "smtp host" }, "SMTP server"],
  ])("rejects bad input %j", (o, word) => {
    const r = parseSettingsBody(body(o));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(word);
  });

  it("treats a hand-edited bad WebUI address as not set", async () => {
    await import("node:fs").then((fs) => fs.writeFileSync(settingsFile(dir), JSON.stringify({ enabled: true, webuiAddress: "javascript:alert(1)" })));
    expect(loadSettings(dir).webuiAddress).toBe("");
  });

  it("normalizes the WebUI address to an origin and reads the password intent", () => {
    const r = parseSettingsBody(body({ webuiAddress: "http://localhost:3847/", password: "pw1", enabled: false }));
    expect(r).toMatchObject({ ok: true, settings: { webuiAddress: "http://localhost:3847" }, password: { kind: "set", value: "pw1" } });
    expect(parseSettingsBody(body({}))).toMatchObject({ password: { kind: "keep" } });
    expect(parseSettingsBody(body({ clearPassword: true }))).toMatchObject({ password: { kind: "clear" } });
  });
});

describe(".env.local secret", () => {
  it("stores the password in .env.local only, with other lines kept, and removes it again", () => {
    writeSmtpPassword(dir, 'p"w\\1');
    expect(readSmtpPassword(dir)).toBe('p"w\\1');
    expect(hasSmtpPassword(dir)).toBe(true);
    expect(existsSync(envFile(dir))).toBe(true);
    expect(existsSync(settingsFile(dir))).toBe(false);
    writeSmtpPassword(dir, null);
    expect(hasSmtpPassword(dir)).toBe(false);
  });

  it("refuses to store the password inside a git repository", () => {
    mkdirSync(path.join(dir, ".git"));
    const inner = path.join(dir, "data");
    expect(insideGitRepo(inner)).toBe(true);
    expect(() => writeSmtpPassword(inner, "x")).toThrow(/git repository/);
    expect(existsSync(envFile(inner))).toBe(false);
  });

  it("the default central folder is outside this repository", async () => {
    const { getConfig } = await import("../../config.js");
    const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..", "..");
    const rel = path.relative(repoRoot, getConfig().registryDir);
    expect(rel.startsWith("..") || path.isAbsolute(rel)).toBe(true);
  });

  it("file content is just the one key", () => {
    writeSmtpPassword(dir, "abc");
    expect(readFileSync(envFile(dir), "utf-8")).toBe('SHIPWRIGHT_SMTP_PASSWORD="abc"\n');
  });
});

describe("timer", () => {
  function harness(schedule: { checkInterval: "15m" | "1h" | "daily"; summaryTime: string }) {
    let now = new Date(2026, 10, 22, 7, 0, 0);
    let runs = 0;
    let cb: (() => void) | null = null;
    let cleared = false;
    const timer = startReminderMailTimer({
      run: async () => { runs++; },
      getSchedule: () => schedule,
      now: () => now,
      setIntervalFn: (fn) => { cb = fn; return {}; },
      clearIntervalFn: () => { cleared = true; },
    });
    return { timer, runs: () => runs, advance: async (ms: number) => { now = new Date(now.getTime() + ms); await timer.tick(); }, fire: () => cb?.(), cleared: () => cleared };
  }

  it("checks once at start, then hourly", async () => {
    const h = harness({ checkInterval: "1h", summaryTime: "08:00" });
    await h.timer.started;
    expect(h.runs()).toBe(1);
    await h.advance(59 * 60_000);
    expect(h.runs()).toBe(1);
    await h.advance(60_000);
    expect(h.runs()).toBe(2);
  });

  it("honours 15 minutes", async () => {
    const h = harness({ checkInterval: "15m", summaryTime: "08:00" });
    await h.timer.started;
    await h.advance(15 * 60_000);
    await h.advance(15 * 60_000);
    expect(h.runs()).toBe(3);
  });

  it("daily mode runs at the summary time, once per day", async () => {
    const h = harness({ checkInterval: "daily", summaryTime: "08:00" });
    await h.timer.started; // 07:00 start run
    await h.advance(30 * 60_000); // 07:30, same day
    expect(h.runs()).toBe(1);
    await h.advance(24 * 3600_000); // next day 07:30, before the time
    expect(h.runs()).toBe(1);
    await h.advance(40 * 60_000); // 08:10
    expect(h.runs()).toBe(2);
    await h.advance(5 * 60_000);
    expect(h.runs()).toBe(2);
  });

  it("daily mode: a start check before the summary time does not use up the day (the 08:00 summary still goes out)", async () => {
    const h = harness({ checkInterval: "daily", summaryTime: "08:00" });
    await h.timer.started; // 07:00 start
    await h.advance(30 * 60_000); // 07:30
    expect(h.runs()).toBe(1);
    await h.advance(31 * 60_000); // 08:01
    expect(h.runs()).toBe(2);
    await h.advance(60 * 60_000);
    expect(h.runs()).toBe(2);
  });

  it("a check that did not run (mail off) is retried on the next tick, so turning mail on is picked up at once", async () => {
    let on = false;
    let runs = 0;
    let now = new Date(2026, 10, 22, 9, 0, 0);
    const timer = startReminderMailTimer({
      run: async () => { runs++; return { ran: on }; },
      getSchedule: () => ({ checkInterval: "1h", summaryTime: "08:00" }),
      now: () => now,
      setIntervalFn: () => ({}),
    });
    await timer.started;
    now = new Date(now.getTime() + 60_000);
    await timer.tick();
    expect(runs).toBe(2);
    on = true;
    now = new Date(now.getTime() + 60_000);
    await timer.tick();
    now = new Date(now.getTime() + 60_000);
    await timer.tick(); // ran last tick, the hour has not passed
    expect(runs).toBe(3);
  });

  it("a failing check does not stop the timer and logs no error object", async () => {
    const lines: Record<string, unknown>[] = [];
    let n = 0;
    const timer = startReminderMailTimer({
      run: async () => { n++; throw Object.assign(new Error("boom secret"), { code: "E1" }); },
      getSchedule: () => ({ checkInterval: "15m", summaryTime: "08:00" }),
      now: () => new Date(2026, 10, 22, 7, 0, 0),
      setIntervalFn: () => ({}),
      log: (l) => lines.push(l),
    });
    await timer.started;
    expect(n).toBe(1);
    expect(JSON.stringify(lines)).not.toContain("boom secret");
  });

  it("stop clears the interval", async () => {
    const h = harness({ checkInterval: "1h", summaryTime: "08:00" });
    h.timer.stop();
    expect(h.cleared()).toBe(true);
  });
});
