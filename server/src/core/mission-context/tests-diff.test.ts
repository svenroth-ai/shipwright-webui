/*
 * tests-diff.test.ts — the Tests baseline-diff (CONTRACT §10 Slice-2, AC2).
 *
 * The case that drives the design is REMOVAL. A removed test cannot be found by
 * inspecting the current traceability manifest — its entry is gone, which is
 * precisely what removal means — so the run's own commit diff is the only source
 * that can classify it. These cases pin that, and pin the far more dangerous
 * failure: git being unable to answer must NEVER read as "no tests changed".
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

import {
  inferLayer,
  isTestFile,
  parseNameStatus,
  readChangedTestFiles,
  MAX_TEST_FILES,
} from "./tests-diff.js";

/** `git … -z` emits `<status>NUL<path>NUL…`, verified against real git output. */
function z(...pairs: [string, string][]): string {
  return pairs.map(([s, p]) => `${s}\0${p}\0`).join("");
}

describe("parseNameStatus", () => {
  it("classifies added / modified / REMOVED from git's status letters", () => {
    const { files } = parseNameStatus(
      z(
        ["A", "client/src/lib/new.test.ts"],
        ["M", "client/src/lib/existing.test.ts"],
        ["D", "client/e2e/flows/retired.spec.ts"],
      ),
    );
    expect(files).toEqual([
      { path: "client/src/lib/new.test.ts", kind: "added" },
      { path: "client/src/lib/existing.test.ts", kind: "modified" },
      { path: "client/e2e/flows/retired.spec.ts", kind: "removed" },
    ]);
  });

  it("keeps ONLY test files — a production file must not appear as a test", () => {
    const { files } = parseNameStatus(
      z(
        ["M", "client/src/lib/missionArtifacts.ts"],
        ["M", "server/src/index.ts"],
        ["M", "CHANGELOG.md"],
        ["A", "client/src/lib/missionArtifacts.test.ts"],
      ),
    );
    expect(files.map((f) => f.path)).toEqual(["client/src/lib/missionArtifacts.test.ts"]);
  });

  it("parses a path containing a TAB or a NEWLINE — the reason for -z", () => {
    // Line-based parsing mangles both of these, silently.
    const { files } = parseNameStatus(
      z(["A", "client/src/we\tird.test.ts"], ["M", "client/src/two\nlines.test.ts"]),
    );
    expect(files).toEqual([
      { path: "client/src/we\tird.test.ts", kind: "added" },
      { path: "client/src/two\nlines.test.ts", kind: "modified" },
    ]);
  });

  it("parses non-ASCII paths unchanged", () => {
    const { files } = parseNameStatus(z(["A", "client/src/lib/grüße.test.ts"]));
    expect(files).toEqual([{ path: "client/src/lib/grüße.test.ts", kind: "added" }]);
  });

  it("passes the path through VERBATIM — no backslash fold, no trim", () => {
    // Both edits partially undid the `-z` hardening: git always reports POSIX
    // paths, so a backslash is a literal character in the filename and
    // surrounding whitespace is part of the name. Either one silently breaks
    // the manifest join (internal code review, FIX-IF-CHEAP).
    const { files } = parseNameStatus(
      z(["A", "client/src/back\\slash.test.ts"], ["M", " client/src/ spaced .test.ts"]),
    );
    expect(files.map((f) => f.path)).toEqual([
      // A backslash is a literal character here, NOT a separator — folding it
      // to "/" invents a directory and breaks the manifest join.
      "client/src/back\\slash.test.ts",
      // Leading whitespace is part of the name and survives.
      " client/src/ spaced .test.ts",
    ]);
  });

  it("caps the row list and REPORTS the truncation instead of silently clipping", () => {
    const pairs: [string, string][] = [];
    for (let i = 0; i < MAX_TEST_FILES + 10; i++) pairs.push(["A", `client/src/f${i}.test.ts`]);
    const { files, truncated } = parseNameStatus(z(...pairs));
    expect(files).toHaveLength(MAX_TEST_FILES);
    expect(truncated).toBe(true);
  });

  it("holds a cap above the largest REAL commit measured in this repo (116 files)", () => {
    // Calibration, not a guess: a cap below this would truncate the #289
    // traceability retrofit, a commit that actually exists on main.
    expect(MAX_TEST_FILES).toBeGreaterThan(116);
    const pairs: [string, string][] = [];
    for (let i = 0; i < 116; i++) pairs.push(["M", `client/src/f${i}.test.ts`]);
    const { files, truncated } = parseNameStatus(z(...pairs));
    expect(files).toHaveLength(116);
    expect(truncated).toBe(false);
  });

  it("does not report truncation when everything fit", () => {
    const { files, truncated } = parseNameStatus(z(["A", "a.test.ts"], ["M", "b.test.ts"]));
    expect(files).toHaveLength(2);
    expect(truncated).toBe(false);
  });

  it("ignores empty tokens and unknown status letters", () => {
    const { files } = parseNameStatus(z(["X", "weird.test.ts"], ["A", "real.test.ts"]));
    expect(files).toEqual([{ path: "real.test.ts", kind: "added" }]);
  });

  it("tolerates the trailing NUL git emits", () => {
    const { files } = parseNameStatus("A\0a.test.ts\0");
    expect(files).toEqual([{ path: "a.test.ts", kind: "added" }]);
  });

  it("de-duplicates a path git reported twice", () => {
    const { files } = parseNameStatus(z(["M", "a.test.ts"], ["M", "a.test.ts"]));
    expect(files).toHaveLength(1);
  });
});

describe("isTestFile / inferLayer", () => {
  it("recognises both real conventions and rejects production code", () => {
    expect(isTestFile("client/src/lib/x.test.ts")).toBe(true);
    expect(isTestFile("client/src/c/X.test.tsx")).toBe(true);
    expect(isTestFile("client/e2e/flows/12-x.spec.ts")).toBe(true);
    expect(isTestFile("client/e2e/helpers/seed.ts")).toBe(true);
    expect(isTestFile("client/src/lib/x.ts")).toBe(false);
    expect(isTestFile("server/src/index.ts")).toBe(false);
    // "latest" ends in "test" but is not a test file.
    expect(isTestFile("docs/latest.ts")).toBe(false);
  });

  it("infers the layer a REMOVED file's manifest entry can no longer supply", () => {
    expect(inferLayer("client/e2e/flows/9-x.spec.ts")).toBe("e2e");
    expect(inferLayer("client/src/lib/x.test.ts")).toBe("unit");
    // No signal in the path — an honest null beats an invented layer.
    expect(inferLayer("weird/file.ts")).toBeNull();
  });
});

describe("readChangedTestFiles", () => {
  const neverCalled = () => {
    throw new Error("git must not be invoked");
  };

  it("REJECTS a non-hex commit before it can become a git argument", () => {
    for (const bad of ["--upload-pack=evil", "HEAD", "main", "../etc", "abc", "", "zz11223"]) {
      const r = readChangedTestFiles("/root", bad, neverCalled);
      expect(r, `${JSON.stringify(bad)} must be rejected`).toEqual({
        status: "unavailable",
        reason: "bad_commit",
      });
    }
  });

  it("reports `unavailable` — NOT an empty ok — when the run recorded no commit", () => {
    expect(readChangedTestFiles("/root", null, neverCalled)).toEqual({
      status: "unavailable",
      reason: "bad_commit",
    });
  });

  it("reports `unavailable` when git throws, so a failure never reads as 'no tests'", () => {
    const r = readChangedTestFiles("/root", "66e275ae", () => {
      throw new Error("not a git repository");
    });
    expect(r).toEqual({ status: "unavailable", reason: "git_failed" });
  });

  it("passes the sha as an ARGUMENT ARRAY with rename detection off", () => {
    let seen: string[] = [];
    readChangedTestFiles("/root", "66e275ae", (args) => {
      seen = args;
      return "";
    });
    expect(seen).toContain("66e275ae");
    expect(seen).toContain("--no-renames");
    // `-z` is load-bearing: without it a path containing a tab or newline is
    // silently mis-parsed (external plan review, MEDIUM #6).
    expect(seen).toContain("-z");
    expect(seen[0]).toBe("show");
    // The sha must never be concatenated into a single command string.
    expect(seen.some((a) => a.includes(" "))).toBe(false);
  });

  it("returns an ok-but-empty result when git answered and no test file moved", () => {
    const r = readChangedTestFiles("/root", "66e275ae", () => z(["M", "README.md"]));
    expect(r).toEqual({ status: "ok", files: [], truncated: false });
  });
});
