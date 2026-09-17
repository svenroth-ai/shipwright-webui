/*
 * The `trackWrittenTestFile` tracker itself - adoption, aging, the staleness
 * cap and the tracked-set cap. Split out of
 * `missionActivityFeedAuthoringTrack.test.ts` at the project's 300-line
 * convention (67th review round); that file keeps the path-shape and
 * shell-parsing halves. */
import { describe, expect, it } from "vitest";
import { trackWrittenTestFile } from "./missionActivityFeedAuthoringTrack";

describe("trackWrittenTestFile", () => {
  it("adopts the path (staleness 0) on a Write to a test file, stamped with the tool's own id", () => {
    expect(trackWrittenTestFile([], "Write", { file_path: "src/lib/foo.test.ts" }, "t1")).toEqual([{ path: "src/lib/foo.test.ts", staleness: 0, sourceToolId: "t1" }]);
  });

  // 27th-round catch (openai, medium): an Edit with no matching Write targets
  // a file Claude never wrote, so it must not start tracking.
  it("does not track a bare Edit to a test file with no matching prior Write", () => {
    expect(trackWrittenTestFile([], "Edit", { file_path: "tests/test_foo.py" }, "t2")).toEqual([]);
  });

  it("passes the set through unchanged for a non-test file or a non-Write tool", () => {
    expect(trackWrittenTestFile([], "Write", { file_path: "src/lib/foo.ts" }, "t1")).toEqual([]);
    expect(trackWrittenTestFile([], "Bash", { command: "vitest run" }, "t1")).toEqual([]);
  });

  it("ages every tracked entry by one on an unrelated tool call", () => {
    const tracked = [{ path: "prior.test.ts", staleness: 2, sourceToolId: "t0" }];
    expect(trackWrittenTestFile(tracked, "Bash", { command: "npm run build" }, "t1")).toEqual([{ path: "prior.test.ts", staleness: 3, sourceToolId: "t0" }]);
  });

  // External review + code-reviewer catch, all three independently: left
  // unbounded, a long-ago write would still read as "immediate" when run.
  it("drops an entry once it exceeds the staleness cap", () => {
    const tracked = [{ path: "prior.test.ts", staleness: 5, sourceToolId: "t0" }];
    expect(trackWrittenTestFile(tracked, "Bash", { command: "npm run build" }, "t1")).toEqual([]);
  });

  it("adds a fresh Write/Edit alongside an already-tracked, still-fresh entry", () => {
    const tracked = [{ path: "old.test.ts", staleness: 4, sourceToolId: "t0" }];
    expect(trackWrittenTestFile(tracked, "Write", { file_path: "new.test.ts" }, "t1")).toEqual([
      { path: "old.test.ts", staleness: 5, sourceToolId: "t0" },
      { path: "new.test.ts", staleness: 0, sourceToolId: "t1" },
    ]);
  });

  // 4th-round catch (openai, medium): the prior single-slot tracker dropped
  // `a.test.ts` the instant `b.test.ts` was written ("write a, write b, run a").
  it("re-writing a test file already tracked refreshes it to staleness 0 instead of duplicating it", () => {
    const tracked = [{ path: "a.test.ts", staleness: 3, sourceToolId: "t0" }];
    expect(trackWrittenTestFile(tracked, "Write", { file_path: "a.test.ts" }, "t1")).toEqual([{ path: "a.test.ts", staleness: 0, sourceToolId: "t1" }]);
  });

  // 73rd-round catch (openai, low), FIXED: at a cap of 5 the SIXTH consecutive
  // Write evicted `a.test.ts` while the staleness window still held it fresh,
  // so that file's own first run was stamped as official verification. The set
  // cap is now tied to `MAX_AUTHORING_TRACK_CARRY`, making the two bounds
  // consistent - nothing is evicted while still inside the window. Falsify by
  // setting `MAX_TRACKED_TEST_FILES` back to 5: `a.test.ts` disappears.
  it("keeps every write that is still inside the staleness window, even a six-file TDD burst", () => {
    let tracked: ReturnType<typeof trackWrittenTestFile> = [];
    for (const path of ["a.test.ts", "b.test.ts", "c.test.ts", "d.test.ts", "e.test.ts", "f.test.ts"]) {
      tracked = trackWrittenTestFile(tracked, "Write", { file_path: path }, path);
    }
    expect(tracked.map((entry) => entry.path)).toEqual(["a.test.ts", "b.test.ts", "c.test.ts", "d.test.ts", "e.test.ts", "f.test.ts"]);
    // The staleness window is the SOLE bound now: `a.test.ts` is already at
    // staleness 5, so one more unrelated call retires it on schedule, not by
    // eviction. That is what keeps this from being an unbounded set.
    tracked = trackWrittenTestFile(tracked, "Bash", { command: "npm run build" }, "t9");
    expect(tracked.map((entry) => entry.path)).toEqual(["b.test.ts", "c.test.ts", "d.test.ts", "e.test.ts", "f.test.ts"]);
  });
});
