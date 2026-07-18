import { describe, it, expect } from "vitest";

import { projectEventLog } from "./event-log-reader.js";
import { projectGradeTrend } from "./run-data-join.js";
import { projectCampaignEvents } from "./campaign-events.js";
import { recordsFromLines } from "./jsonl-records.js";

/*
 * event-log-recovery.test.ts — record-boundary recovery across ALL THREE
 * independent projections over `shipwright_events.jsonl`
 * (iterate-2026-07-19-events-reader-recovery).
 *
 * Why this file exists rather than three additions: `event-log-reader.ts`,
 * `run-data-join.ts` (`projectGradeTrend`) and `campaign-events.ts` each scan
 * the SAME bytes with their OWN loop. Before this change all three skipped a
 * whole line on `JSON.parse` failure, so two events sharing one physical line
 * vanished from every one of them. Keeping the proof in one place is what makes
 * "they agree" checkable — that agreement is the actual invariant.
 *
 * The concatenation is reachable WITHOUT any crash: the file carries
 * `merge=union` in .gitattributes, and union merge joins an unterminated blob's
 * last line to the other side's first.
 */

function work(runId: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: `evt-${runId}`,
    type: "work_completed",
    adr_id: runId,
    ts: "2026-07-19T08:00:00Z",
    commit: `sha-${runId}`,
    ...extra,
  });
}

describe("event-log recovery — projectEventLog", () => {
  it("recovers BOTH runs when two events share one physical line", () => {
    const lines = [work("run-a"), work("run-b") + work("run-c")];
    const p = projectEventLog(lines);
    expect(p.runs.map((r) => r.runId).sort()).toEqual(["run-a", "run-b", "run-c"]);
  });

  it("counts physical LINES in total/skipped and RECORDS in parsed", () => {
    // One clean line + one line holding two records. The counters keep their
    // historical line-based meaning, so `parsedLines` exceeding `totalLines` is
    // the honest signal that recovery contributed extra records.
    const p = projectEventLog([work("run-a"), work("run-b") + work("run-c")]);
    expect(p.totalLines).toBe(2);
    expect(p.parsedLines).toBe(3);
    expect(p.skippedLines).toBe(0);
  });

  it("keeps a valid record and still counts the line as skipped on partial damage", () => {
    const p = projectEventLog([work("run-a") + '{"type":"work_completed"']);
    expect(p.runs.map((r) => r.runId)).toEqual(["run-a"]);
    expect(p.skippedLines).toBe(1);
    expect(p.totalLines).toBe(1);
  });

  it("preserves wire order, so the later of two same-key runs still wins", () => {
    // Both records share a ts; the tiebreak is file index. Recovered records
    // must take CONSECUTIVE increasing indices or last-wins silently inverts.
    const first = work("dup", { commit: "sha-first" });
    const second = work("dup", { commit: "sha-second" });
    const p = projectEventLog([first + second]);
    expect(p.runs).toHaveLength(1);
    expect(p.runs[0].commit).toBe("sha-second");
  });

  it("still skips a wholly undecodable line without throwing (no regression)", () => {
    const p = projectEventLog(["not json at all", work("run-a")]);
    expect(p.runs.map((r) => r.runId)).toEqual(["run-a"]);
    expect(p.skippedLines).toBe(1);
  });
});

describe("event-log recovery — projectGradeTrend (second pass, same bytes)", () => {
  const snap = (grade: string, ts: string) =>
    JSON.stringify({ type: "grade_snapshot", grade, ts });

  it("recovers both snapshots from a concatenated line", () => {
    const rows = projectGradeTrend([
      snap("B", "2026-07-19T08:00:00Z") + snap("A", "2026-07-19T09:00:00Z"),
    ]);
    expect(rows.map((r) => r.grade)).toEqual(["B", "A"]);
  });

  it("agrees with projectEventLog about how many records a damaged line holds", () => {
    // The invariant that matters: two independent scans of one file must not
    // disagree. Mixed line: a grade snapshot concatenated onto a work_completed.
    const mixed = work("run-a") + snap("A", "2026-07-19T09:00:00Z");
    expect(projectEventLog([mixed]).parsedLines).toBe(2);
    expect(projectGradeTrend([mixed])).toHaveLength(1); // 1 of the 2 is a snapshot
  });
});

describe("event-log recovery — projectCampaignEvents (third pass)", () => {
  const sub = (campaign: string, sid: string, commit: string) =>
    JSON.stringify({
      type: "work_completed",
      campaign,
      sub_iterate_id: sid,
      commit,
      ts: "2026-07-19T08:00:00Z",
    });

  it("recovers a sub-iterate completion from a concatenated line", () => {
    // The product consequence this prevents: applyEventsProjection never
    // downgrades, so a dropped work_completed leaves a FINISHED step rendering
    // as `pending` forever.
    const p = projectCampaignEvents([sub("camp", "C1", "sha1") + sub("camp", "C2", "sha2")]);
    const byId = p.get("camp");
    expect([...(byId?.keys() ?? [])].sort()).toEqual(["C1", "C2"]);
    expect(byId?.get("C2")?.commit).toBe("sha2");
  });
});

describe("recordsFromLines — the shared primitive", () => {
  it("reports every non-blank physical line exactly once, blanks never", () => {
    const seen: { lineNo: number; corrupt: boolean }[] = [];
    const out = [
      ...recordsFromLines(
        ['{"a":1}', "", "   ", '{"b":2}{"c":3}', '{"d":4}garbage'],
        (info) => seen.push(info),
      ),
    ];
    expect(out).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }]);
    expect(seen).toEqual([
      { lineNo: 1, corrupt: false },
      { lineNo: 4, corrupt: false },
      { lineNo: 5, corrupt: true },
    ]);
  });

  it("is safe to consume without a callback", () => {
    expect([...recordsFromLines(['{"a":1}{"b":2}'])]).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
