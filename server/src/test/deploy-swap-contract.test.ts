/**
 * CI-gated regression guard: what `scripts/deploy-swap.mjs` + `deploy-procs.mjs`
 * must do, because nobody else can (iterate-2026-07-14-deploy-self-kill).
 *
 * Companion to deploy-detach.test.ts, which pins the CALLER's half of the same
 * contract (build, hand off, never kill). This file pins the SWAPPER's half: it is
 * the only process still alive after the server-kill tears down the embedded
 * terminal that started the deploy, so every step that must still happen — kill,
 * start, readiness, heal, verdict — has to happen HERE, and has to survive.
 *
 * Text assertions only (the .mjs is never imported), keeping scripts/ outside the
 * coverage / diff-cover scope like every other file there. See deploy-detach.test.ts
 * for why these guards live under server/src/test/ rather than next to the scripts.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(path.resolve(here, "../../../"), "scripts");
const read = (f: string) => fs.readFileSync(path.join(scripts, f), "utf8");

const swap = read("deploy-swap.mjs"); // the deploy choreography
const procs = read("deploy-procs.mjs"); // process discovery + termination

describe("the swapper owns every step that must outlive the caller", () => {
  it("kills the old listener", () => {
    expect(procs).toMatch(/taskkill|process\.kill/);
  });

  it("kills ONE process, never the tree (/T would kill the swapper itself)", () => {
    // The swapper is spawned by the caller, which — inside an embedded terminal —
    // is a descendant of the Hono server the swapper is about to kill. So the
    // swapper is a descendant of its own target: `taskkill /F /T` (what
    // dev-restart.js uses) would sweep the target's descendants and take the
    // swapper down with it, re-creating the outage from inside the fix.
    const treeKills = procs
      .split(/\r?\n/)
      // Comments name the footgun explicitly — only real code counts.
      .filter((l) => !/^\s*(\*|\/\/)/.test(l))
      .filter((l) => /taskkill/i.test(l) && /\/T\b/.test(l));
    expect(
      treeKills,
      "taskkill must target /PID only — a /T tree kill includes this very process",
    ).toEqual([]);
  });

  it("starts the fresh build detached", () => {
    expect(swap).toMatch(/dist[\\/]index\.js/);
    expect(swap, "the new server must outlive the swapper too").toMatch(/detached:\s*true/);
  });

  it("records the outcome durably, in EVERY path (the caller may be dead)", () => {
    expect(swap).toMatch(/deploy-status\.json/);
    // Including the unexpected: a throw after the kill would otherwise leave no
    // server AND no status — the failure mode that made the outage invisible.
    expect(swap, "main() must not be able to die without leaving a verdict").toMatch(
      /\.catch\(/,
    );
  });

  it("runs the post-restart ~/.claude.json heal (it sat in caller code that is dead by then)", () => {
    expect(swap).toMatch(/repair-claude-json\.mjs/);
  });

  it("heals only AFTER the readiness check (the clean window: old sessions dead, new ones not yet spawned)", () => {
    const swapLines = swap.split(/\r?\n/);
    const ready = swapLines.findIndex((l) => /await waitForServerUp\(/.test(l));
    const healed = swapLines.findIndex((l) => /^\s*heal\('post-restart'\)/.test(l));
    expect(ready, "expected a readiness poll in main()").toBeGreaterThanOrEqual(0);
    expect(healed, "expected a post-restart heal() in main()").toBeGreaterThanOrEqual(0);
    expect(
      healed,
      "the heal must run after the restart is confirmed — that is the window where " +
        "the old embedded `claude` writers are gone and a UI reload has not spawned " +
        "new ones; healing before it just races them again.",
    ).toBeGreaterThan(ready);
  });

  it("does not start a new server when the port never came free (old server beats no server)", () => {
    // If the kill did not land, starting anyway means EADDRINUSE and a machine with
    // NOTHING running. A stale old server is bad; no server at all is the outage.
    expect(procs).toMatch(/freed:\s*false/);
    expect(swap).toMatch(/if\s*\(!freed\)/);
  });

  it("readiness means OUR child owns the port — a surviving old listener is not success", () => {
    expect(procs).toMatch(/findListenerPids\(port\)\.includes\(String\(child\.pid\)\)/);
  });

  it("degrades readiness (never fails) where listeners cannot be observed (no lsof)", () => {
    // findListenerPids() returns [] both for "nothing is listening" and for "I
    // cannot see listeners". Without this fallback a POSIX host without lsof would
    // report every healthy deploy as failed. The pre-fix .sh had it; keep it.
    expect(procs).toMatch(/canDiscoverListeners\(/);
    expect(procs).toMatch(/process-alive/);
  });

  it("a log file it cannot open never blocks the server start", () => {
    // The log path is shared across instances, and a server launched the old way
    // holds it with restrictive sharing (EBUSY). Losing the log is a nuisance —
    // losing the SERVER over a log file would be this iterate's own bug, rebuilt.
    expect(swap).toMatch(/openServerLog/);
    expect(swap).toMatch(/'w',\s*'a'/);
  });
});
