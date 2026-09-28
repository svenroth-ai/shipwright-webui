/*
 * routes.recovery.midfile.test.ts — split out of routes.recovery.test.ts once
 * that file crossed the project's 300-line convention (same pattern as
 * `run-id-recovery-user-lines.test.ts` splitting off `run-id-recovery.test.ts`).
 *
 * iterate-2026-09-28-mission-feed-completeness, AC2 — end-to-end proof that
 * `wire.ts`'s `startedMidFile` signal actually reaches `findRunIdFooter`
 * through the full route → resolver → recovery-thunk chain, not just the
 * unit-level passthrough already covered in run-id-recovery*.test.ts. The
 * fixture is a byte-cut `tool_result` fragment quoting a corroborated run id
 * with NO real footer following it — exactly the shape a truncated
 * bounded-tail read produces when the cut lands inside a large tool result.
 *
 * @covers FR-01.66
 */

import { beforeEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";

import { _clearResolverCache } from "../../core/mission-context/resolver.js";
import { _clearEventIndexCache } from "../../core/mission-context/iterate-record.js";
import { _clearRecoveryMemo } from "../../core/mission-context/run-id-recovery.js";
import { getContext, harness, makeProject, makeTask, RUN_ID } from "./test-harness.js";
import { prunePointer, recordRun } from "./routes.recovery.test.js";

// @covers FR-01.66
describe("GET mission-context — startedMidFile changes whether a byte-cut fragment is adopted", () => {
  beforeEach(() => {
    _clearResolverCache();
    _clearEventIndexCache();
    _clearRecoveryMemo();
  });

  it("adopts the fragment's run id when the reader does not report a mid-file start", async () => {
    const root = makeProject();
    try {
      prunePointer(root);
      recordRun(root);
      const fragment = `,"content":"padding\\n\\nRun-ID: ${RUN_ID}\\n"}]}}\n`;
      const { app } = harness(root, makeTask(), {
        reads: [{ text: fragment, revision: "rev-1", startedMidFile: false }],
      });

      const ctx = await getContext(app);
      expect(ctx.scenario).toBe("iterate");
      expect(ctx.runId).toBe(RUN_ID);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("declines the same fragment once the reader reports a mid-file start", async () => {
    const root = makeProject();
    try {
      prunePointer(root);
      recordRun(root);
      const fragment = `,"content":"padding\\n\\nRun-ID: ${RUN_ID}\\n"}]}}\n`;
      const { app } = harness(root, makeTask(), {
        reads: [{ text: fragment, revision: "rev-1", startedMidFile: true }],
      });

      const ctx = await getContext(app);
      expect(ctx.scenario).toBe("plain");
      expect(ctx.runId).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
