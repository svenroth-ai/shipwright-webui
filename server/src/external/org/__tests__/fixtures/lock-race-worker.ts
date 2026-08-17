/*
 * lock-race-worker.ts — standalone script run as a SEPARATE OS PROCESS by
 * two-process-lock.test.ts. It is not itself a test file.
 *
 * Why a separate process at all: `write.ts`-style fs calls are synchronous
 * with no event-loop yield, so a same-process `Promise.all` racing two
 * `withDecisionsLock` calls would never actually interleave — proper-lockfile
 * itself is the only thing that can be raced honestly, and that requires two
 * real OS-level lock holders.
 *
 * Protocol: argv = [leadsRoot, label, holdMs, resultFile, mode?]. Acquires
 * the FR-04.28 lock (unless `mode === "nolock"`, see below), records the
 * wall-clock interval it held the critical section, appends its own
 * numbered logged entry (proving numbering stays sequential across
 * processes), sleeps `holdMs` INSIDE the lock (widening the window in which
 * a second, unlocked worker would visibly overlap), then writes
 * `{label, start, insideStart, insideEnd, number}` to its own `resultFile`
 * — a separate file per worker so the two processes never need to
 * coordinate a shared-file append themselves.
 *
 * Doubt-review fix (LOW-MEDIUM, unquantified false-pass margin): `mode ===
 * "nolock"` bypasses `withDecisionsLock` and does the identical
 * read-sleep-append sequence unguarded — a falsification control
 * (two-process-lock.test.ts's own "without the lock" test) that empirically
 * proves THIS harness actually detects a broken lock, rather than asserting
 * it by construction.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

import {
  withDecisionsLock,
  resolveDecisionsPaths,
  parseLoggedEntries,
  nextLoggedNumber,
} from "../../decisions-lock.js";

const [, , leadsRoot, label, holdMsRaw, resultFile, mode] = process.argv;
const holdMs = Number(holdMsRaw);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function criticalSection(loggedPath: string, start: number): Promise<void> {
  const insideStart = Date.now();
  const raw = existsSync(loggedPath) ? readFileSync(loggedPath, "utf8") : "";
  const entries = parseLoggedEntries(raw);
  const number = nextLoggedNumber(entries);

  // Widen the critical section deliberately — this is the window a
  // lock-bypass bug would show up as an overlapping [insideStart, insideEnd]
  // pair from the other worker.
  await sleep(holdMs);

  const pad = String(number).padStart(4, "0");
  const needsLeadingNewline = raw.length > 0 && !raw.endsWith("\n");
  const block = `${needsLeadingNewline ? "\n" : ""}## ADR-${pad} [race-${label}] worker-${label}\nbody written by worker ${label}\n`;
  appendFileSync(loggedPath, block);

  const insideEnd = Date.now();
  writeFileSync(resultFile, JSON.stringify({ label, start, insideStart, insideEnd, number }));
}

async function main(): Promise<void> {
  const start = Date.now();
  if (mode === "nolock") {
    const { loggedPath } = resolveDecisionsPaths(leadsRoot);
    await criticalSection(loggedPath, start);
    return;
  }
  await withDecisionsLock({ leadsRoot }, async (ctx) => {
    await criticalSection(ctx.loggedPath, start);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
