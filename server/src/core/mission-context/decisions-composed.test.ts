/*
 * The COMPOSED Decisions record — drops ∪ decision_log, deduplicated by run_id.
 *
 * The governing rule, restated where it is enforced: "we could not read the
 * records" and "this run decided nothing" are DIFFERENT facts, and only the
 * second one is allowed to disappear.
 *
 * Cache-invalidation and real-data probes live in `decisions-rev.test.ts`.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readRunDecisionRecord } from "./decisions.js";
import { buildDecisionsArtifact } from "./artifacts-decisions.js";
import { FOUND } from "./slice2-test-fixtures.js";

const RUN = "iterate-2026-07-19-example";
const DROPS = [".shipwright", "agent_docs", "decision-drops"];
const LOG = [".shipwright", "agent_docs", "decision_log.md"];

function makeProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "sw-dec-"));
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

function writeLog(root: string, text: string): void {
  mkdirSync(path.join(root, ...LOG.slice(0, 2)), { recursive: true });
  writeFileSync(path.join(root, ...LOG), text, "utf-8");
}

describe("readRunDecisionRecord — drops ∪ decision_log, deduplicated by run_id", () => {
  it("surfaces a drop-only run, unnumbered, instead of rendering nothing", () => {
    const root = makeProject();
    try {
      writeDrop(root, `${RUN}_001.json`, drop());
      const rec = readRunDecisionRecord(root, RUN);

      expect(rec.entries).toHaveLength(1);
      expect(rec.entries[0].source).toBe("drop");
      // Never fabricated: no release has numbered this decision yet.
      expect(rec.entries[0].adrId).toBeNull();
      expect(rec.sawUnreadable).toBe(false);

      // …and it must actually SHOW. Before this change the artifact hid.
      const a = buildDecisionsArtifact(rec, FOUND);
      expect(a.state).toBe("available");
      expect(a.summary).toContain("Not yet published in a release.");
      // The receipt must not invent an identifier for an unnumbered decision.
      expect(a.receipt).toBe("1 decision");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the LOG wins for a decision that WAS published — the drop is suppressed", () => {
    const root = makeProject();
    try {
      // `aggregate_decisions.py` renders the drop's own `title` as the ADR
      // heading, so a matching title means "this drop became that entry".
      writeDrop(root, `${RUN}_001.json`, drop({ title: "A decision recorded at F3" }));
      writeLog(root, `### ADR-500: A decision recorded at F3\n\n- **Run-ID:** ${RUN}\n\nbody\n`);
      const rec = readRunDecisionRecord(root, RUN);

      expect(rec.entries).toHaveLength(1);
      expect(rec.entries[0].source).toBe("decision_log");
      expect(rec.entries[0].adrId).toBe("ADR-500");
      // The same decision twice, under two identities, is worse than either.
      expect(rec.entries.filter((e) => e.source === "drop")).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a PARTIALLY folded run still shows the drop that was never published", () => {
    const root = makeProject();
    try {
      // The real partial-fold path: `aggregate_decisions.py` snapshots the drops
      // it will fold, so a drop written DURING aggregation is never snapshotted
      // and simply stays on disk. `_001` is published; `_002` is not.
      writeDrop(root, `${RUN}_001.json`, drop({ title: "Published decision" }));
      writeDrop(root, `${RUN}_002.json`, drop({ title: "Still pending decision" }));
      writeLog(root, `### ADR-500: Published decision\n\n- **Run-ID:** ${RUN}\n\nbody\n`);
      const rec = readRunDecisionRecord(root, RUN);

      // The run-level short-circuit rendered ONLY the log entry here and
      // reported sawUnreadable:false — the second decision vanished silently.
      expect(rec.entries).toHaveLength(2);
      expect(rec.entries[0].adrId).toBe("ADR-500");
      expect(rec.entries[0].source).toBe("decision_log");
      expect(rec.entries[1].title).toBe("Still pending decision");
      expect(rec.entries[1].source).toBe("drop");
      expect(rec.entries[1].adrId).toBeNull();

      const a = buildDecisionsArtifact(rec, FOUND);
      expect(a.state).toBe("available");
      expect(a.summary).toContain("not yet published in a release");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("an unreadable drops directory is NOT masked by a readable log", () => {
    const root = makeProject();
    try {
      writeLog(root, `### ADR-500: Published decision\n\n- **Run-ID:** ${RUN}\n\nbody\n`);
      // A FILE where the drops directory belongs — readdir fails with ENOTDIR.
      writeFileSync(path.join(root, ...DROPS), "not a directory", "utf-8");

      const rec = readRunDecisionRecord(root, RUN);
      expect(rec.entries).toHaveLength(1);
      // The log answered, but a source we did not read cannot be asserted empty.
      // The old short-circuit hardcoded `false` here without ever looking.
      expect(rec.sawUnreadable).toBe(true);
      expect(rec.logOrScanLoss).toBe(true);

      const a = buildDecisionsArtifact(rec, FOUND);
      expect(a.state).toBe("available");
      expect(a.summary).toContain("may be incomplete");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("states a countable loss AND an uncountable one — they are additive", () => {
    const root = makeProject();
    try {
      writeDrop(root, `${RUN}_001.json`, drop({ title: "Survives" }));
      writeFileSync(path.join(root, ...DROPS, `${RUN}_002.json`), "{{{", "utf-8");
      // ...plus a log that exists and cannot be read, which has no count at all.
      const logPath = path.join(root, ...LOG);
      mkdirSync(path.dirname(logPath), { recursive: true });
      mkdirSync(logPath, { recursive: true }); // a DIRECTORY where the log belongs

      const rec = readRunDecisionRecord(root, RUN);
      const a = buildDecisionsArtifact(rec, FOUND);
      // A ternary made these exclusive, so the number silently absorbed the log.
      expect(a.summary).toContain("could not be read.");
      expect(a.summary).toContain("may be incomplete");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("a drops directory that cannot be READ is unavailable, never 'no decisions'", () => {
    const root = makeProject();
    try {
      // A FILE where the drops directory belongs: readdir fails with ENOTDIR,
      // which is a fault — not the ENOENT "nobody has run F3 here" case.
      mkdirSync(path.join(root, ...DROPS.slice(0, 2)), { recursive: true });
      writeFileSync(path.join(root, ...DROPS), "not a directory", "utf-8");

      const rec = readRunDecisionRecord(root, RUN);
      expect(rec.entries).toHaveLength(0);
      expect(rec.sawUnreadable).toBe(true);

      const a = buildDecisionsArtifact(rec, FOUND);
      // The load-bearing assertion. `not_applicable` would HIDE the artifact,
      // and a hidden artifact reads as "this run decided nothing" — a claim we
      // cannot support when the source was unreadable.
      expect(a.state).toBe("unavailable");
      expect(a.note).toBeTruthy();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a malformed drop is disclosed while the valid one still renders", () => {
    const root = makeProject();
    try {
      writeDrop(root, `${RUN}_001.json`, drop({ title: "Survives" }));
      writeFileSync(path.join(root, ...DROPS, `${RUN}_002.json`), "{{{", "utf-8");

      const rec = readRunDecisionRecord(root, RUN);
      expect(rec.entries).toHaveLength(1);
      expect(rec.malformedCount).toBe(1);

      const a = buildDecisionsArtifact(rec, FOUND);
      expect(a.state).toBe("available");
      expect(a.summary).toContain("could not be read");
      expect(a.detail?.malformedCount).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("an ABSENT decision_log.md is not a fault — most projects never had a release", () => {
    const root = makeProject();
    try {
      // No decision_log.md and no drops: a project that has simply never
      // aggregated. Reporting `sawUnreadable` here would pin Decisions at
      // "records could not be read" forever — the same unreadable/absent
      // collapse this iterate exists to remove, one level up.
      mkdirSync(path.join(root, ...DROPS), { recursive: true });
      expect(existsSync(path.join(root, ...LOG))).toBe(false);

      const rec = readRunDecisionRecord(root, RUN);
      expect(rec.sawUnreadable).toBe(false);
      expect(buildDecisionsArtifact(rec, FOUND).state).toBe("not_applicable");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("an unusable run id IS a fault, even though it reports like an absent log", () => {
    const root = makeProject();
    try {
      mkdirSync(path.join(root, ...DROPS), { recursive: true });
      // The log reader says `missing` for this too, which the fix above treats
      // as benign — so the drops reader's `denied` is what must keep it visible.
      const rec = readRunDecisionRecord(root, "../../../etc");
      expect(rec.sawUnreadable).toBe(true);
      expect(buildDecisionsArtifact(rec, FOUND).state).toBe("unavailable");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps ALL of a run's drops — a run may record more than one decision", () => {
    const root = makeProject();
    try {
      // The `_NNN` suffix exists precisely because a run can record several.
      // Picking one arbitrarily would hide the rest (external plan review,
      // gemini MEDIUM / openai HIGH #2).
      writeDrop(root, `${RUN}_002.json`, drop({ title: "Second decision" }));
      writeDrop(root, `${RUN}_001.json`, drop({ title: "First decision" }));
      writeDrop(root, `${RUN}_003.json`, drop({ title: "Third decision" }));

      const rec = readRunDecisionRecord(root, RUN);
      expect(rec.entries).toHaveLength(3);
      // …in their recorded sequence, not in whatever order the OS enumerated.
      expect(rec.entries.map((e) => e.title)).toEqual([
        "First decision",
        "Second decision",
        "Third decision",
      ]);
      expect(rec.entries.every((e) => e.source === "drop")).toBe(true);

      const a = buildDecisionsArtifact(rec, FOUND);
      expect(a.state).toBe("available");
      expect(a.summary).toContain("2 other decisions");
      expect(a.receipt).toBe("3 decisions");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("both sources clean and empty still HIDES — an absence is allowed to be one", () => {
    const root = makeProject();
    try {
      mkdirSync(path.join(root, ...DROPS), { recursive: true });
      writeLog(root, "### ADR-1: unrelated\n\n- **Run-ID:** iterate-other\n\nbody\n");
      const rec = readRunDecisionRecord(root, RUN);
      expect(rec.entries).toHaveLength(0);
      expect(rec.sawUnreadable).toBe(false);
      expect(buildDecisionsArtifact(rec, FOUND).state).toBe("not_applicable");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
