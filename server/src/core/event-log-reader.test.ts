/*
 * event-log-reader.test.ts — A01 (campaign webui-wow-usability-2026-07-10).
 * RED on pre-fix main (no reader existed). Covers: present-fields projection,
 * missing/malformed fields incl. the no-phase_timings case (AC2 honest null),
 * torn line (AC3), absent file (AC1), adr_id dedupe, phase read-through
 * (multiple ends + splitId), and the runId filter (taskDetail single-run view).
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  projectEventLog,
  readEventLog,
  EVENT_FILE,
} from "./event-log-reader.js";

const FULL_WC = {
  v: 1,
  id: "evt-aa11bb22",
  ts: "2026-07-10T10:00:00.000000+00:00",
  type: "work_completed",
  source: "iterate",
  commit: "abc1234def5678",
  intent: "feature",
  change_type: "feature",
  description: "the long description",
  summary: "the human summary",
  spec_impact: "MODIFY",
  adr_id: "iterate-2026-07-10-aa11bb22",
  affected_frs: ["FR-01.28", "FR-01.29"],
  new_frs: ["FR-01.46"],
  tests: { passed: 1882, total: 1882, e2e_run: false },
  campaign: "webui-wow-usability-2026-07-10",
  sub_iterate_id: "A01",
};

const j = (o: unknown): string => JSON.stringify(o);

describe("projectEventLog — present fields", () => {
  it("projects the full work_completed record", () => {
    const proj = projectEventLog([j(FULL_WC)]);
    expect(proj.runCount).toBe(1);
    const run = proj.runs[0];
    expect(run.runId).toBe("iterate-2026-07-10-aa11bb22");
    expect(run.eventId).toBe("evt-aa11bb22");
    expect(run.ts).toBe("2026-07-10T10:00:00.000000+00:00");
    expect(run.source).toBe("iterate");
    expect(run.intent).toBe("feature");
    expect(run.changeType).toBe("feature");
    expect(run.summary).toBe("the human summary");
    expect(run.commit).toBe("abc1234def5678");
    expect(run.specImpact).toBe("MODIFY"); // raw case preserved
    expect(run.affectedFrs).toEqual(["FR-01.28", "FR-01.29"]);
    expect(run.newFrs).toEqual(["FR-01.46"]);
    expect(run.tests).toEqual({ passed: 1882, total: 1882 });
    expect(run.campaign).toBe("webui-wow-usability-2026-07-10");
    expect(run.subIterateId).toBe("A01");
    expect(proj.latestRun).toEqual(run);
    expect(proj.parsedLines).toBe(1);
    expect(proj.skippedLines).toBe(0);
  });
});

describe("projectEventLog — honest degradation (AC2)", () => {
  it("returns phaseTimings null when absent — never fabricated", () => {
    const proj = projectEventLog([j(FULL_WC)]); // FULL_WC carries no phase_timings
    expect(proj.runs[0].phaseTimings).toBeNull();
  });

  it("reads phase_timings THROUGH untouched when present", () => {
    const timings = [
      { mark: "start", ts: "2026-07-10T10:00:00Z" },
      { mark: "tests", ts: "2026-07-10T10:05:00Z" },
    ];
    const proj = projectEventLog([j({ ...FULL_WC, phase_timings: timings })]);
    expect(proj.runs[0].phaseTimings).toEqual(timings);
  });

  it("degrades every optional field to null/[] when the record is bare", () => {
    const bare = {
      type: "work_completed",
      adr_id: "iterate-2026-07-10-bare0001",
    };
    const proj = projectEventLog([j(bare)]);
    const run = proj.runs[0];
    expect(run.runId).toBe("iterate-2026-07-10-bare0001");
    // Absent optionals → null / []; commit null is distinct from present-empty "".
    for (const k of ["eventId", "ts", "summary", "commit", "specImpact", "tests", "phaseTimings", "campaign"] as const) {
      expect(run[k]).toBeNull();
    }
    expect(run.affectedFrs).toEqual([]);
    expect(run.newFrs).toEqual([]);
  });

  it("preserves a present-but-empty commit (worktree F5b emits commit: '')", () => {
    const proj = projectEventLog([j({ ...FULL_WC, commit: "" })]);
    expect(proj.runs[0].commit).toBe(""); // present-empty, NOT coerced to null
  });

  it("tolerates a partial tests object (one mark absent)", () => {
    const proj = projectEventLog([j({ ...FULL_WC, tests: { passed: 5 } })]);
    expect(proj.runs[0].tests).toEqual({ passed: 5, total: null });
  });

  it("degrades malformed nested field types to null/[]; keeps string frs only", () => {
    const proj = projectEventLog([
      j({
        ...FULL_WC,
        tests: "passed", // wrong type — must not crash field access
        affected_frs: ["FR-01.1", 2, null, "FR-01.2"], // mixed → strings only
        new_frs: { nope: 1 }, // object, not array
        commit: 42, // non-string
        spec_impact: null,
      }),
    ]);
    const run = proj.runs[0];
    expect(run.tests).toBeNull();
    expect(run.affectedFrs).toEqual(["FR-01.1", "FR-01.2"]);
    expect(run.newFrs).toEqual([]);
    expect(run.commit).toBeNull();
    expect(run.specImpact).toBeNull();
  });
});

describe("projectEventLog — tolerance (AC3)", () => {
  it("skips a torn/corrupt line and counts it, never throws", () => {
    const lines = [
      j(FULL_WC),
      "{ this is not valid json",
      "", // blank — ignored entirely
      j({ ...FULL_WC, id: "evt-cc33", adr_id: "iterate-2026-07-10-cc330000" }),
    ];
    let proj!: ReturnType<typeof projectEventLog>;
    expect(() => {
      proj = projectEventLog(lines);
    }).not.toThrow();
    expect(proj.runCount).toBe(2);
    expect(proj.parsedLines).toBe(2);
    expect(proj.skippedLines).toBe(1); // the torn line only; blank excluded
    expect(proj.totalLines).toBe(3);
  });

  it("skips a non-object JSON line (array/number)", () => {
    const proj = projectEventLog([j([1, 2, 3]), j(42), j(FULL_WC)]);
    expect(proj.runCount).toBe(1);
    expect(proj.skippedLines).toBe(2);
  });

  it("does not project a work_completed without adr_id (no join key)", () => {
    const proj = projectEventLog([j({ type: "work_completed", commit: "x" })]);
    expect(proj.runCount).toBe(0);
    expect(proj.parsedLines).toBe(1); // parsed, just not a joinable run
  });
});

describe("projectEventLog — dedupe by adr_id (latest wins)", () => {
  it("keeps the latest work_completed per adr_id by ts", () => {
    const older = {
      ...FULL_WC,
      ts: "2026-07-10T09:00:00.000000+00:00",
      summary: "older",
      commit: "old",
    };
    const newer = {
      ...FULL_WC,
      ts: "2026-07-10T11:00:00.000000+00:00",
      summary: "newer",
      commit: "new",
    };
    // Emit newer FIRST to prove the ts sort wins over file order.
    const proj = projectEventLog([j(newer), j(older)]);
    expect(proj.runCount).toBe(1);
    expect(proj.runs[0].summary).toBe("newer");
  });

  it("breaks a ts tie by file order (last line wins)", () => {
    const a = { ...FULL_WC, summary: "first" };
    const b = { ...FULL_WC, summary: "second" };
    const proj = projectEventLog([j(a), j(b)]);
    expect(proj.runs[0].summary).toBe("second");
  });

  it("sorts multiple runs newest-first", () => {
    const r1 = { ...FULL_WC, adr_id: "run-1", ts: "2026-07-10T08:00:00Z" };
    const r2 = { ...FULL_WC, adr_id: "run-2", ts: "2026-07-10T12:00:00Z" };
    const proj = projectEventLog([j(r1), j(r2)]);
    expect(proj.runs.map((r) => r.runId)).toEqual(["run-2", "run-1"]);
    expect(proj.latestRun?.runId).toBe("run-2");
  });
});

describe("projectEventLog — phase transitions read-through", () => {
  it("projects every transition in file order, never collapsed", () => {
    const lines = [
      j({ id: "e1", type: "phase_started", phase: "build", splitId: "s1" }),
      j({ id: "e2", type: "phase_completed", phase: "build", splitId: "s1" }),
      // Same phase, a SECOND completed end — must NOT be collapsed (#369).
      j({ id: "e3", type: "phase_completed", phase: "build", splitId: "s2" }),
      j({ id: "e4", type: "phase_failed", phase: "review", detail: "boom" }),
    ];
    const proj = projectEventLog(lines);
    expect(proj.phaseTransitions).toHaveLength(4);
    expect(proj.phaseTransitions[1]).toEqual({
      eventId: "e2",
      type: "phase_completed",
      phase: "build",
      ts: null,
      splitId: "s1",
      detail: null,
    });
    expect(proj.phaseTransitions[2].splitId).toBe("s2"); // second end preserved
    expect(proj.phaseTransitions[3].detail).toBe("boom");
  });

  it("reads a snake_case split_id through untouched", () => {
    const proj = projectEventLog([
      j({ type: "phase_completed", phase: "build", split_id: "snake" }),
    ]);
    expect(proj.phaseTransitions[0].splitId).toBe("snake");
  });

  it("does not project event_amended / grade_snapshot as runs or phases", () => {
    const proj = projectEventLog([
      j({ type: "event_amended", amends: "evt-x", fields: {} }),
      j({ type: "grade_snapshot", score: 99 }),
    ]);
    expect(proj.runCount).toBe(0);
    expect(proj.phaseTransitions).toHaveLength(0);
    expect(proj.parsedLines).toBe(2); // seen, just not projected
  });
});

describe("projectEventLog — runId filter", () => {
  it("filters runs to the requested adr_id", () => {
    const a = { ...FULL_WC, adr_id: "run-a" };
    const b = { ...FULL_WC, adr_id: "run-b" };
    const proj = projectEventLog([j(a), j(b)], { runId: "run-b" });
    expect(proj.runCount).toBe(1);
    expect(proj.runs[0].runId).toBe("run-b");
    expect(proj.latestRun?.runId).toBe("run-b");
    // phaseTransitions are global (not runId-keyed) — always returned in full.
  });

  it("returns zero runs for an unknown runId", () => {
    const proj = projectEventLog([j(FULL_WC)], { runId: "nope" });
    expect(proj.runCount).toBe(0);
    expect(proj.latestRun).toBeNull();
  });
});

describe("readEventLog — file wrapper (AC1)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = (): string => {
    const d = mkdtempSync(path.join(os.tmpdir(), "evlog-"));
    dirs.push(d);
    return d;
  };

  it("returns an empty projection when the log is absent (no throw)", () => {
    const proj = readEventLog(tmp());
    expect(proj.runs).toEqual([]);
    expect(proj.runCount).toBe(0);
    expect(proj.totalLines).toBe(0);
  });

  it("returns an empty projection when the projectRoot does not exist", () => {
    const proj = readEventLog(path.join(os.tmpdir(), "does-not-exist-xyz"));
    expect(proj.runCount).toBe(0);
  });

  it("reads a real on-disk log; trailing newline is not a torn line", () => {
    const root = tmp();
    // Trailing "\n" (the JSONL norm) must NOT be counted as a torn line.
    writeFileSync(
      path.join(root, EVENT_FILE),
      [j(FULL_WC), "torn{", j({ ...FULL_WC, adr_id: "run-2" })].join("\n") + "\n",
      "utf-8",
    );
    const proj = readEventLog(root);
    expect(proj.runCount).toBe(2);
    expect(proj.skippedLines).toBe(1); // only "torn{" — not the trailing newline
  });

  it("threads the runId filter through the file wrapper", () => {
    const root = tmp();
    writeFileSync(
      path.join(root, EVENT_FILE),
      [j(FULL_WC), j({ ...FULL_WC, adr_id: "run-2" })].join("\n"),
      "utf-8",
    );
    expect(readEventLog(root, { runId: "run-2" }).runs[0].runId).toBe("run-2");
  });
});
