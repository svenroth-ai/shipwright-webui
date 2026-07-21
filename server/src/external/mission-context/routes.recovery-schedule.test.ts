/*
 * routes.recovery-schedule.test.ts — WHEN the route asks for the wide
 * reach-back window (iterate-2026-07-21-mission-recovery-memo-perf).
 *
 * Split out of `routes.recovery.test.ts`, which these pushed to 308 lines. That
 * file answers "is the identity recovered?"; this one answers "what did it cost
 * to find out?" — a different question, and the size rule is not negotiable in
 * the very run whose brief carried a bloat watch item.
 *
 * @covers FR-01.66
 */

import { beforeEach, describe, expect, it } from "vitest";
import { rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { _clearResolverCache } from "../../core/mission-context/resolver.js";
import { _clearEventIndexCache } from "../../core/mission-context/iterate-record.js";
import { _clearRecoveryMemo } from "../../core/mission-context/run-id-recovery.js";
import { RECOVERY_TAIL_BYTES, TRANSCRIPT_TAIL_BYTES } from "./routes.js";
import { getContext, harness, makeProject, makeTask, RUN_ID, UUID } from "./test-harness.js";

/** The F6 footer exactly as it appears inside a JSONL record. */
const FOOTER = `{"text":"feat: something\n\nRun-ID: ${RUN_ID}\nCo-Authored-By: Claude <n@a.com>"}`;

/** Drop the pointer — this is what `prune_stale_run_pointers` does at Finalize. */
function prunePointer(root: string): void {
  unlinkSync(join(root, ".shipwright", "iterate_active", `${UUID}.json`));
}

/** The project's own record of the run — the corroboration the recovery needs. */
function recordRun(root: string): void {
  writeFileSync(
    join(root, "shipwright_events.jsonl"),
    `${JSON.stringify({
      v: 1,
      type: "work_completed",
      id: RUN_ID,
      adr_id: RUN_ID,
      ts: "2026-07-20T10:00:00Z",
      summary: "Did the thing",
      commit: "a".repeat(40),
    })}
`,
    "utf-8",
  );
}

/*
 * The wide window is a REACH-BACK into history, not a standing subscription.
 * MEASURED on this machine, the earlier "unidentified ⇒ always wide" rule was
 * permanent for 412 of 419 tasks, over transcripts 78 % of which exceed 1 MB —
 * ~425 KB of extra read, decode and allocation per poll per open tab, forever
 * (internal code review of PR #309, PERF).
 *
 * These observe the BYTE BUDGET SEQUENCE rather than a single call, because the
 * schedule is the behaviour: asserting one poll's budget passes whether or not
 * the next one repeats it.
 */
describe("GET mission-context — the wide reach-back schedule", () => {
  const PLAIN = '{"text":"an ordinary conversation"}';
  const budgets = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => c[1]);

  beforeEach(() => {
    _clearResolverCache();
    _clearEventIndexCache();
    _clearRecoveryMemo();
  });

  it("reaches back ONCE for an unidentified session whose transcript never changes", async () => {
    const root = makeProject();
    try {
      prunePointer(root);
      const { app, readTranscriptTail } = harness(root, makeTask(), {
        reads: [{ text: PLAIN, revision: "r1" }],
      });

      for (let poll = 0; poll < 4; poll++) expect((await getContext(app)).scenario).toBe("plain");
      // Wide once; then the transcript is unchanged, so there is nothing new to
      // reach back INTO — anything written later lands in the ordinary tail.
      expect(budgets(readTranscriptTail)).toEqual([
        RECOVERY_TAIL_BYTES,
        TRANSCRIPT_TAIL_BYTES,
        TRANSCRIPT_TAIL_BYTES,
        TRANSCRIPT_TAIL_BYTES,
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reaches back AGAIN once the transcript has moved, and still recovers", async () => {
    const root = makeProject();
    try {
      prunePointer(root);
      recordRun(root);
      const { app, readTranscriptTail, tasks } = harness(root, makeTask(), {
        reads: [
          { text: PLAIN, revision: "r1" },
          { text: PLAIN, revision: "r1" },
          // The session finalizes and keeps talking: the footer is written and
          // then buried past the ordinary window, so ONLY the reach-back sees
          // it. The revision moves, which is what earns the next reach-back.
          { text: FOOTER, narrowText: PLAIN, revision: "r2" },
        ],
      });

      expect((await getContext(app)).scenario).toBe("plain");
      expect((await getContext(app)).scenario).toBe("plain");
      // Poll 3 still reads narrow — the budget is chosen from what poll 2 saw,
      // which is the one-poll lag that keeps this to a single read per poll.
      expect((await getContext(app)).scenario).toBe("plain");
      expect((await getContext(app)).scenario).toBe("iterate");
      expect(budgets(readTranscriptTail)).toEqual([
        RECOVERY_TAIL_BYTES,
        TRANSCRIPT_TAIL_BYTES,
        TRANSCRIPT_TAIL_BYTES,
        RECOVERY_TAIL_BYTES,
      ]);
      expect(tasks.get("task-1")?.missionContext?.runId).toBe(RUN_ID);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("evicting at the cap does not punish the tasks already in the map", async () => {
    const root = makeProject();
    try {
      prunePointer(root);
      const { app, readTranscriptTail } = harness(
        root,
        [makeTask(), makeTask({ taskId: "task-2" })],
        { reads: [{ text: PLAIN, revision: "r1" }], wideWindowCap: 2 },
      );

      await getContext(app, "task-1");
      await getContext(app, "task-2");
      await getContext(app, "task-1");
      await getContext(app, "task-2");
      // Clearing on EVERY write instead of only when a NEW key would overflow
      // means that, at capacity, each poll evicts every other task and hands it
      // a fresh 1 MB reach-back although its transcript never moved — the exact
      // cost this schedule exists to remove. Poll 4 is where that shows.
      expect(budgets(readTranscriptTail)).toEqual([
        RECOVERY_TAIL_BYTES,
        RECOVERY_TAIL_BYTES,
        TRANSCRIPT_TAIL_BYTES,
        TRANSCRIPT_TAIL_BYTES,
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("an already-identified task does not consume the cap", async () => {
    const root = makeProject();
    try {
      prunePointer(root);
      recordRun(root);
      const identified = makeTask({
        taskId: "task-known",
        missionContext: {
          kind: "iterate",
          runId: RUN_ID,
          observedAt: "2026-07-21T10:00:00.000Z",
          source: "iterate_active_pointer",
        },
      });
      const { app, readTranscriptTail } = harness(
        root,
        [makeTask(), identified, makeTask({ taskId: "task-3" })],
        { reads: [{ text: PLAIN, revision: "r1" }], wideWindowCap: 2 },
      );

      await getContext(app, "task-1"); // reaches back, takes a slot
      await getContext(app, "task-known"); // can never reach back — takes none
      await getContext(app, "task-3"); // reaches back, takes the second slot
      await getContext(app, "task-1"); // its marker must still be there

      // Recording a task that can never go wide is not merely wasteful: at the
      // cap it evicts a task that CAN, handing it another 1 MB reach-back.
      expect(budgets(readTranscriptTail)).toEqual([
        RECOVERY_TAIL_BYTES,
        TRANSCRIPT_TAIL_BYTES,
        RECOVERY_TAIL_BYTES,
        TRANSCRIPT_TAIL_BYTES,
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a ROLLED-BACK association takes the reach-back marker down with it", async () => {
    const root = makeProject();
    try {
      prunePointer(root);
      recordRun(root);
      const { app, readTranscriptTail, tasks } = harness(root, makeTask(), {
        // The footer lives beyond the ordinary window — only the reach-back
        // reads it, which is the measured band 8 of 50 recoveries sit in.
        reads: [{ text: FOOTER, narrowText: PLAIN, revision: "r1" }],
        persistThrows: true,
      });

      // Poll 1 recovers, fails to persist (ELOCKED from a second webui), and
      // rolls the in-memory association back — so the task is unidentified again.
      expect((await getContext(app)).scenario).toBe("iterate");
      expect(tasks.get("task-1")?.missionContext).toBeUndefined();

      // Poll 2 must therefore reach back AGAIN. Leaving the marker behind would
      // pin the task to the ordinary tail while it is unidentified — re-entering
      // through the read side exactly the permanent data loss the rollback
      // exists to prevent.
      expect((await getContext(app)).scenario).toBe("iterate");
      expect(budgets(readTranscriptTail)).toEqual([RECOVERY_TAIL_BYTES, RECOVERY_TAIL_BYTES]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a read that yields NO revision never marks the reach-back done", async () => {
    const root = makeProject();
    try {
      prunePointer(root);
      const { app, readTranscriptTail } = harness(root, makeTask(), {
        // What `wire.ts` returns when the transcript cannot be located or read.
        reads: [{ text: "", revision: "" }],
      });

      for (let poll = 0; poll < 3; poll++) await getContext(app);
      // "We could not look" must never be recorded as "we looked" — otherwise a
      // transient fault would strand the task unidentified forever.
      expect(budgets(readTranscriptTail)).toEqual([
        RECOVERY_TAIL_BYTES,
        RECOVERY_TAIL_BYTES,
        RECOVERY_TAIL_BYTES,
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
