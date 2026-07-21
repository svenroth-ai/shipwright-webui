/*
 * routes.recovery.test.ts — the run identity is recovered from the session's own
 * transcript, and the recovery is PERSISTED (iterate-2026-07-21).
 *
 * The defect these pin: `task.missionContext` was only ever written while the
 * Mission tab happened to be open DURING the run, and the pointer is deleted at
 * Finalize — so on the operator's real machine 1 task in 416 carried an
 * association and a finished iterate answered `plain` forever.
 *
 * Separate file from routes.test.ts / routes.integrity.test.ts so each stays
 * within the size rule and this reads as one story.
 *
 * @covers FR-01.66
 */

import { beforeEach, describe, expect, it } from "vitest";
import { rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { _clearResolverCache } from "../../core/mission-context/resolver.js";
import { _clearEventIndexCache } from "../../core/mission-context/iterate-record.js";
import { RECOVERY_TAIL_BYTES, TRANSCRIPT_TAIL_BYTES } from "./routes.js";
import { getContext, harness, makeProject, makeTask, RUN_ID, UUID } from "./test-harness.js";

/** The F6 footer exactly as it appears inside a JSONL record. */
const FOOTER = `{"text":"feat: something\\n\\nRun-ID: ${RUN_ID}\\nCo-Authored-By: Claude <noreply@anthropic.com>"}`;

/** Drop the pointer — this is what `prune_stale_run_pointers` does at Finalize. */
function prunePointer(root: string): void {
  unlinkSync(join(root, ".shipwright", "iterate_active", `${UUID}.json`));
}

/** The project's own record of the run — the corroboration the recovery needs. */
function recordRun(root: string, runId = RUN_ID): void {
  writeFileSync(
    join(root, "shipwright_events.jsonl"),
    `${JSON.stringify({
      v: 1,
      type: "work_completed",
      id: runId,
      adr_id: runId,
      ts: "2026-07-20T10:00:00Z",
      summary: "Did the thing",
      commit: "a".repeat(40),
    })}\n`,
    "utf-8",
  );
}

describe("GET mission-context — recovering a pruned run identity", () => {
  beforeEach(() => {
    _clearResolverCache();
    _clearEventIndexCache();
  });

  it("resolves the ITERATE from the transcript footer after the pointer is pruned", async () => {
    const root = makeProject();
    try {
      prunePointer(root);
      recordRun(root);
      const { app, persist, tasks } = harness(root, makeTask(), { transcript: FOOTER });

      const ctx = await getContext(app);
      expect(ctx.scenario).toBe("iterate");
      expect(ctx.runId).toBe(RUN_ID);
      // Finished, not in flight — the pointer is gone.
      expect(ctx.runLive).toBe(false);

      // …and it is PERSISTED, so the scan is paid once, not once per poll.
      expect(tasks.get("task-1")?.missionContext).toEqual({
        kind: "iterate",
        runId: RUN_ID,
        observedAt: expect.any(String),
        source: "transcript_run_id",
      });
      expect(persist).toHaveBeenCalledTimes(1);

      // A second poll writes nothing further (idempotent compare-and-set).
      await getContext(app);
      expect(persist).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stays PLAIN when the transcript carries no footer — never a guess", async () => {
    const root = makeProject();
    try {
      prunePointer(root);
      recordRun(root);
      const { app, persist, tasks } = harness(root, makeTask(), {
        transcript: '{"text":"a normal conversation with no commit at all"}',
      });

      const ctx = await getContext(app);
      expect(ctx.scenario).toBe("plain");
      expect(ctx.runId).toBeNull();
      expect(tasks.get("task-1")?.missionContext).toBeUndefined();
      expect(persist).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stays PLAIN when the quoted run is not one of THIS project's runs", async () => {
    const root = makeProject();
    try {
      prunePointer(root);
      // The log knows a DIFFERENT run — the quoted id has no record here, which
      // is the measured cross-repo case (a webui session quoting a monorepo run).
      recordRun(root, "iterate-2026-07-20-a-different-run");
      const { app, persist } = harness(root, makeTask(), { transcript: FOOTER });

      const ctx = await getContext(app);
      expect(ctx.scenario).toBe("plain");
      expect(persist).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does NOT rescue an INVALID pointer — that stays an honest `unavailable`", async () => {
    const root = makeProject();
    try {
      recordRun(root);
      // A pointer bound to another session: §5.1(a) rejects it as `invalid`.
      writeFileSync(
        join(root, ".shipwright", "iterate_active", `${UUID}.json`),
        JSON.stringify({
          run_id: RUN_ID,
          slug: "demo",
          main_root: root,
          session_id: "11111111-2222-3333-4444-555555555555",
        }),
      );
      const { app, persist } = harness(root, makeTask(), { transcript: FOOTER });

      const ctx = await getContext(app);
      for (const a of ctx.artifacts) expect(a.state).toBe("unavailable");
      expect(persist).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads the WIDER tail only while unidentified, then drops back", async () => {
    const root = makeProject();
    try {
      prunePointer(root);
      recordRun(root);
      const { app, readTranscriptTail } = harness(root, makeTask(), { transcript: FOOTER });

      await getContext(app);
      expect(readTranscriptTail).toHaveBeenLastCalledWith(UUID, RECOVERY_TAIL_BYTES);

      // The first call persisted the association, so the next poll is cheap again.
      await getContext(app);
      expect(readTranscriptTail).toHaveBeenLastCalledWith(UUID, TRANSCRIPT_TAIL_BYTES);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a LIVE pointer still wins and is recorded as the pointer, not the footer", async () => {
    const root = makeProject();
    try {
      recordRun(root);
      const other = `{"text":"Run-ID: iterate-2026-07-20-a-different-run\\n"}`;
      const { app, tasks } = harness(root, makeTask(), { transcript: other });

      const ctx = await getContext(app);
      expect(ctx.runId).toBe(RUN_ID);
      expect(tasks.get("task-1")?.missionContext?.source).toBe("iterate_active_pointer");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
