/*
 * The awaiting-launch probe, extracted from `session-watcher.ts` by
 * iterate-2026-07-22-transcript-cursor-single-walk to make room under the
 * 300-line convention.
 *
 * It had ZERO coverage where it was, which is the worst combination for an
 * operator diagnostic: it is only ever exercised during a field incident, so a
 * silent break surfaces exactly when someone is relying on it. A move is the
 * cheapest moment to fix that — these tests pin the enable condition and the
 * emitted strings so the extraction is verifiably behaviour-identical rather
 * than assumed to be.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { awaitingLaunchProbe } from "./session-watcher-debug.js";
import { SessionWatcher } from "./session-watcher.js";

const UUID = "11111111-2222-4333-8444-555555555555";
const FLAG = "SHIPWRIGHT_DEBUG_AWAITING_LAUNCH";

afterEach(() => {
  delete process.env[FLAG];
  vi.restoreAllMocks();
});

describe("awaitingLaunchProbe — the enable condition", () => {
  it("is null unless the flag is exactly '1' or 'true'", () => {
    delete process.env[FLAG];
    expect(awaitingLaunchProbe()).toBeNull();
    for (const off of ["", "0", "false", "yes", "TRUE"]) {
      process.env[FLAG] = off;
      expect(awaitingLaunchProbe()).toBeNull();
    }
  });

  it("is active for '1' and for 'true'", () => {
    for (const on of ["1", "true"]) {
      process.env[FLAG] = on;
      expect(awaitingLaunchProbe()).not.toBeNull();
    }
  });

  it("is read per call, so flipping the env mid-process takes effect", () => {
    delete process.env[FLAG];
    expect(awaitingLaunchProbe()).toBeNull();
    process.env[FLAG] = "1";
    expect(awaitingLaunchProbe()).not.toBeNull();
  });
});

describe("awaitingLaunchProbe — the emitted lines (unchanged by the move)", () => {
  it("formats hit / miss / readdir-failure exactly as before", () => {
    process.env[FLAG] = "1";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const probe = awaitingLaunchProbe()!;

    probe.hit("uuid-1", "enc-cwd", 512);
    probe.miss("uuid-2", ["a", "b"]);
    probe.readdirFailed("uuid-3", "/projects");

    expect(log.mock.calls[0][0]).toBe(
      "[awaiting-launch] HIT uuid=uuid-1 encodedCwd=enc-cwd size=512",
    );
    expect(log.mock.calls[1][0]).toBe(
      "[awaiting-launch] miss uuid=uuid-2 walked=2 encodedCwds=a,b",
    );
    expect(log.mock.calls[2][0]).toBe(
      "[awaiting-launch] readdir(projectsDir) failed for uuid=uuid-3 dir=/projects",
    );
  });

  it("truncates the encodedCwds list at 8 with an ellipsis", () => {
    process.env[FLAG] = "1";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    awaitingLaunchProbe()!.miss("u", ["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    // The cap is what makes this safe to leave on: a machine with 200 adopted
    // projects must not print 200 directory names once per poll.
    expect(log.mock.calls[0][0]).toBe(
      "[awaiting-launch] miss uuid=u walked=9 encodedCwds=1,2,3,4,5,6,7,8,…",
    );
  });
});

describe("findByUuid still drives the probe from its real call sites", () => {
  let projectsDir = "";
  afterEach(() => {
    if (projectsDir) {
      try {
        rmSync(projectsDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    projectsDir = "";
  });

  it("logs a HIT with the encoded cwd it matched under", async () => {
    process.env[FLAG] = "1";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    projectsDir = mkdtempSync(path.join(tmpdir(), "probe-hit-"));
    mkdirSync(path.join(projectsDir, "enc-x"), { recursive: true });
    writeFileSync(path.join(projectsDir, "enc-x", `${UUID}.jsonl`), "a\n", "utf-8");

    await new SessionWatcher({ projectsDir }).findByUuid(UUID);
    expect(log).toHaveBeenCalledWith(
      `[awaiting-launch] HIT uuid=${UUID} encodedCwd=enc-x size=2`,
    );
  });

  it("logs a MISS naming the directories it walked — the encoded-cwd mismatch clue", async () => {
    process.env[FLAG] = "1";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    projectsDir = mkdtempSync(path.join(tmpdir(), "probe-miss-"));
    mkdirSync(path.join(projectsDir, "enc-a"), { recursive: true });

    await new SessionWatcher({ projectsDir }).findByUuid(UUID);
    expect(log).toHaveBeenCalledWith(
      `[awaiting-launch] miss uuid=${UUID} walked=1 encodedCwds=enc-a`,
    );
  });

  it("stays silent when the flag is off", async () => {
    delete process.env[FLAG];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    projectsDir = mkdtempSync(path.join(tmpdir(), "probe-off-"));
    await new SessionWatcher({ projectsDir }).findByUuid(UUID);
    expect(log).not.toHaveBeenCalled();
  });
});
