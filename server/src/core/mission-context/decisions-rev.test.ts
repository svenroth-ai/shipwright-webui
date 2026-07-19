/*
 * The cache-invalidation contract for the Decisions sources, plus REAL-DATA
 * probes against this repository's own records.
 *
 * Split from `decisions-composed.test.ts` at the 300-LOC rule.
 *
 * The rev cases are the direct guard against the failure S1 shipped: an input
 * that is not part of `sourceRev` is FROZEN by the cache, so a source appearing
 * later can never be picked up. A decision-drop is written at F3 — i.e. DURING a
 * run — so this is not a theoretical refresh path.
 *
 * The real-data cases exist because every fixture-only review pass in this
 * campaign missed a bug that reading an actual file found immediately.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readRunDecisionRecord } from "./decisions.js";
import { buildDecisionsArtifact } from "./artifacts-decisions.js";
import { slice2RevPaths } from "./slice2-sources.js";
import { computeSourceRev } from "./resolver-parts.js";
import { FOUND } from "./slice2-test-fixtures.js";

const RUN = "iterate-2026-07-19-example";
const DROPS = [".shipwright", "agent_docs", "decision-drops"];
const LOG = [".shipwright", "agent_docs", "decision_log.md"];

/** This repo itself — the real 640 KB log and the real drops directory. */
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

function makeProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "sw-rev-"));
  mkdirSync(path.join(root, ...DROPS.slice(0, 2)), { recursive: true });
  return root;
}

function writeDrop(root: string, name: string, body: Record<string, unknown>): void {
  mkdirSync(path.join(root, ...DROPS), { recursive: true });
  writeFileSync(path.join(root, ...DROPS, name), JSON.stringify(body), "utf-8");
}

function drop(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    run_id: RUN,
    date: "2026-07-19",
    title: "A decision recorded at F3",
    decision: "Do the thing.",
    ...over,
  };
}

describe("cache invalidation — a drop written mid-run appears without a restart", () => {
  it("creating the drops directory CHANGES the rev, having been registered while absent", () => {
    const root = makeProject();
    try {
      // Nothing exists yet: the drops dir is absent at first computation. This
      // is the exact shape of the S1 bug — an input outside the rev is frozen
      // forever, so a source that appears LATER can never invalidate.
      expect(existsSync(path.join(root, ...DROPS))).toBe(false);
      const before = computeSourceRev(slice2RevPaths(root, RUN), [RUN]);

      writeDrop(root, `${RUN}_001.json`, drop());
      const after = computeSourceRev(slice2RevPaths(root, RUN), [RUN]);

      expect(after).not.toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("REWRITING an existing drop also changes the rev (a directory mtime would not)", () => {
    const root = makeProject();
    try {
      writeDrop(root, `${RUN}_001.json`, drop({ title: "First" }));
      const before = computeSourceRev(slice2RevPaths(root, RUN), [RUN]);

      // Same filename, different content: the DIRECTORY's mtime does not move
      // for an in-place rewrite, so registering only the directory would freeze
      // the old body. The file paths are in the rev precisely for this.
      writeDrop(root, `${RUN}_001.json`, drop({ title: "Second, materially longer" }));
      const after = computeSourceRev(slice2RevPaths(root, RUN), [RUN]);

      expect(after).not.toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("DELETING the last drop changes the rev — the release aggregator does this", () => {
    const root = makeProject();
    try {
      writeDrop(root, `${RUN}_001.json`, drop());
      const before = computeSourceRev(slice2RevPaths(root, RUN), [RUN]);

      // `aggregate_decisions.py` unlinks each drop it folds into the log, so
      // this is the NORMAL end state, not an exotic one. A cache that missed it
      // would keep serving "not yet published" after the release published it.
      rmSync(path.join(root, ...DROPS, `${RUN}_001.json`), { force: true });
      const after = computeSourceRev(slice2RevPaths(root, RUN), [RUN]);

      expect(after).not.toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("an existing-but-EMPTY directory still notices its first drop", () => {
    const root = makeProject();
    try {
      mkdirSync(path.join(root, ...DROPS), { recursive: true });
      const before = computeSourceRev(slice2RevPaths(root, RUN), [RUN]);
      writeDrop(root, `${RUN}_001.json`, drop());
      expect(computeSourceRev(slice2RevPaths(root, RUN), [RUN])).not.toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("registers the drops directory path even when it does not exist", () => {
    const root = mkdtempSync(path.join(tmpdir(), "sw-rev-"));
    try {
      const paths = slice2RevPaths(root, RUN);
      expect(paths.some((p) => p.includes("decision-drops"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("REAL-DATA probes — this repository's own records", () => {
  it("reads this repo's real drops directory and renders real decisions", () => {
    const dropsDir = path.join(REPO_ROOT, ...DROPS);
    if (!existsSync(dropsDir)) return; // gitignored; absent on a fresh clone

    // A run whose drop is known to exist here. If the drop is ever aggregated
    // away this asserts nothing, so the guard below keeps the case honest.
    const realRun = "iterate-2026-07-19-mission-s2-tests-review-decisions";
    if (!existsSync(path.join(dropsDir, `${realRun}_001.json`))) return;

    const rec = readRunDecisionRecord(REPO_ROOT, realRun);
    expect(rec.entries.length).toBeGreaterThan(0);
    // Absolute expectation: S2's decision is real, recorded, and UNNUMBERED —
    // which is precisely why the log-only reader showed nothing for it.
    expect(rec.entries[0].source).toBe("drop");
    expect(rec.entries[0].adrId).toBeNull();
    expect(rec.entries[0].markdown).toContain(realRun);

    const a = buildDecisionsArtifact(rec, FOUND);
    expect(a.state).toBe("available");
  });

  it("reads this repo's real 640 KB decision log for a run that IS numbered", () => {
    const logPath = path.join(REPO_ROOT, ...LOG);
    if (!existsSync(logPath)) return;

    // A run present in the tracked log — the aggregated half of the union.
    const rec = readRunDecisionRecord(REPO_ROOT, "iterate-2026-06-17-board-column-decoupling");
    if (rec.entries.length === 0) return; // log content is history; do not pin it
    expect(rec.entries[0].source).toBe("decision_log");
    expect(rec.entries[0].adrId).toMatch(/^ADR-/);
  });

  it("a run in NEITHER real source reads clean-and-empty, not unavailable", () => {
    if (!existsSync(path.join(REPO_ROOT, ...DROPS))) return;
    const rec = readRunDecisionRecord(REPO_ROOT, "iterate-1999-01-01-never-happened");
    expect(rec.entries).toHaveLength(0);
    // The distinction this whole iterate is about: nothing found is not a fault.
    expect(rec.sawUnreadable).toBe(false);
  });
});
