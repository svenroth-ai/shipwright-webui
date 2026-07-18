/*
 * sdk-sessions-validate.missioncontext.test.ts — the LOAD-TIME guard on the
 * persisted `task.missionContext` association (internal code review, MEDIUM).
 *
 * S1 validates the association when it WRITES it (`association.ts`), and
 * `validateExternalTask` drops a malformed one when it READS it back. The
 * read-side guard had no test, so it could have been removed silently — and
 * `sdk-sessions.json` is a file a user can hand-edit and a crash can truncate,
 * which is precisely why the guard exists.
 *
 * What a missing guard would cost: a corrupt `runId` reaching
 * `readReviewState` / `readRunDecisions`, i.e. the unidentifiable-run path.
 * That path is now honest on its own (it reports an integrity fault rather than
 * hiding), but defence in depth means the corrupt value should never get that
 * far — the source is closed here, the symptom is handled there.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

import { validateExternalTask } from "./sdk-sessions-validate.js";

const BASE = {
  taskId: "task-1",
  sessionUuid: "3c9e3e11-4b53-424e-8062-f9f5a24f6b68",
  cwd: "/x",
  pluginDirs: [],
  state: "active",
  title: "Demo",
  projectId: "proj-1",
  createdAt: "2026-07-19T09:00:00Z",
  inbox: { pendingToolUseIds: [], dismissedToolUseIds: [], lastProcessedByteOffset: 0 },
};

const VALID = {
  kind: "iterate",
  runId: "iterate-2026-07-19-demo",
  observedAt: "2026-07-19T10:00:00Z",
  source: "iterate_active_pointer",
};

function load(missionContext: unknown) {
  return validateExternalTask("task-1", { ...BASE, missionContext }, 4);
}

describe("validateExternalTask — missionContext load-time guard", () => {
  it("keeps a well-formed association", () => {
    expect(load(VALID)?.missionContext).toEqual(VALID);
  });

  it("DROPS an association whose runId fails the path grammar", () => {
    // The value that would otherwise reach path-building code.
    for (const runId of [
      "../../etc/passwd",
      "iterate/../../secret",
      "C:/Windows/system32",
      "run id with spaces",
      "",
      "a\0b",
    ]) {
      const task = load({ ...VALID, runId });
      expect(task, runId).not.toBeNull();
      // The FIELD is dropped entirely — never partially trusted.
      expect(task?.missionContext, runId).toBeUndefined();
    }
  });

  it("DROPS a structurally malformed association without failing the whole task", () => {
    for (const bad of [
      null,
      "a string",
      [],
      42,
      {},
      { ...VALID, kind: "pipeline" },
      { ...VALID, source: "somewhere_else" },
      { ...VALID, observedAt: "" },
      { kind: "iterate", runId: "iterate-2026-07-19-demo" },
    ]) {
      const task = load(bad);
      // The task itself must still load — one corrupt optional field cannot
      // take a whole session out of the store.
      expect(task, JSON.stringify(bad)).not.toBeNull();
      expect(task?.missionContext, JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("leaves the field absent when it was never written", () => {
    const task = validateExternalTask("task-1", BASE, 4);
    expect(task).not.toBeNull();
    expect(task?.missionContext).toBeUndefined();
  });
});
