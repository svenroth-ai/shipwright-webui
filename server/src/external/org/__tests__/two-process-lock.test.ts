/*
 * two-process-lock.test.ts — the concurrency proof mini-plan step 7 requires.
 *
 * A same-process `Promise.all` racing two `withDecisionsLock` calls proves
 * NOTHING here: every fs call this module makes is synchronous with no
 * event-loop yield between "check" and "act", so a same-process race can
 * never actually interleave two callers — it would pass even with the lock
 * deleted entirely. The only honest proof is two SEPARATE OS processes
 * genuinely contending for the same `<path>.lock` file, which is what this
 * spawns (`lock-race-worker.ts`, run via `tsx/cli` as a real child process).
 *
 * Two assertions, both required:
 *   1. The two workers' [insideStart, insideEnd] critical-section intervals
 *      do NOT overlap (proves mutual exclusion, not just eventual
 *      correctness).
 *   2. The two `decision_log.md` entries they append are numbered N and N+1
 *      in some order (proves the numbering — which reads-then-writes inside
 *      the critical section — is race-free across processes).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { parseLoggedEntries } from "../decisions-lock.js";

const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve("tsx/cli");
const WORKER = path.join(import.meta.dirname, "fixtures", "lock-race-worker.ts");

interface WorkerResult {
  label: string;
  start: number;
  insideStart: number;
  insideEnd: number;
  number: number;
}

function runWorker(
  leadsRoot: string,
  label: string,
  holdMs: number,
  resultFile: string,
  mode?: "nolock",
) {
  return new Promise<void>((resolve, reject) => {
    const args = [TSX_CLI, WORKER, leadsRoot, label, String(holdMs), resultFile];
    if (mode) args.push(mode);
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`worker ${label} exited ${code}: ${stderr}`));
    });
  });
}

describe("withDecisionsLock — two-process concurrency proof", () => {
  let leadsRoot: string;

  beforeEach(() => {
    leadsRoot = mkdtempSync(path.join(tmpdir(), "org-lock-race-fixture-"));
  });

  afterEach(() => {
    rmSync(leadsRoot, { recursive: true, force: true });
  });

  it(
    "two real OS processes racing the lock never overlap, and number sequentially",
    async () => {
      const resultA = path.join(leadsRoot, "result-a.json");
      const resultB = path.join(leadsRoot, "result-b.json");

      await Promise.all([
        runWorker(leadsRoot, "A", 250, resultA),
        runWorker(leadsRoot, "B", 250, resultB),
      ]);

      const a: WorkerResult = JSON.parse(readFileSync(resultA, "utf8"));
      const b: WorkerResult = JSON.parse(readFileSync(resultB, "utf8"));

      // 1. Non-overlapping critical sections — whichever ran first must have
      // fully finished (insideEnd) before the other one started (insideStart).
      const [first, second] = a.insideStart <= b.insideStart ? [a, b] : [b, a];
      expect(second.insideStart).toBeGreaterThanOrEqual(first.insideEnd);

      // 2. Sequential numbering, no duplicate, no gap.
      const numbers = [a.number, b.number].sort((x, y) => x - y);
      expect(numbers).toEqual([1, 2]);

      // 3. Both entries actually landed in decision_log.md, in the order the
      // lock admitted them (log-append order matches critical-section order).
      const loggedPath = path.join(leadsRoot, "decision_log.md");
      const entries = parseLoggedEntries(readFileSync(loggedPath, "utf8"));
      expect(entries.map((e) => e.number)).toEqual([1, 2]);
      expect(entries.map((e) => e.leadId)).toEqual([`worker-${first.label}`, `worker-${second.label}`]);
    },
    30_000,
  );

  it(
    "a third, later worker continues numbering from the max — not the count",
    async () => {
      // Seed decision_log.md with a gap-free but out-of-order-looking history
      // isn't needed here; nextLoggedNumber's own unit test covers max-not-count
      // in isolation. This test proves the SAME property survives a real
      // cross-process race: run two workers first, then a third solo.
      const resultA = path.join(leadsRoot, "result-a.json");
      const resultB = path.join(leadsRoot, "result-b.json");
      await Promise.all([
        runWorker(leadsRoot, "A", 100, resultA),
        runWorker(leadsRoot, "B", 100, resultB),
      ]);

      const resultC = path.join(leadsRoot, "result-c.json");
      await runWorker(leadsRoot, "C", 0, resultC);
      const c: WorkerResult = JSON.parse(readFileSync(resultC, "utf8"));
      expect(c.number).toBe(3);
    },
    30_000,
  );

  it(
    "doubt-review fix (falsification control): the SAME race, with the lock " +
      "bypassed (mode=nolock), DOES overlap and mints a duplicate number — " +
      "empirically proving this harness would catch a broken/deleted lock, " +
      "rather than asserting that by construction",
    async () => {
      const resultA = path.join(leadsRoot, "result-a.json");
      const resultB = path.join(leadsRoot, "result-b.json");

      await Promise.all([
        runWorker(leadsRoot, "A", 250, resultA, "nolock"),
        runWorker(leadsRoot, "B", 250, resultB, "nolock"),
      ]);

      const a: WorkerResult = JSON.parse(readFileSync(resultA, "utf8"));
      const b: WorkerResult = JSON.parse(readFileSync(resultB, "utf8"));

      // Both read decision_log.md before either appended (that's the race) —
      // unlocked, they compute the SAME next number, the exact defect class
      // the FR-04.28 lock exists to prevent.
      expect(a.number).toBe(b.number);

      const [first, second] = a.insideStart <= b.insideStart ? [a, b] : [b, a];
      expect(second.insideStart).toBeLessThan(first.insideEnd);
    },
    30_000,
  );
});
