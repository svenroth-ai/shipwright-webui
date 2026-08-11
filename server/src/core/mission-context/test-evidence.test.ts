import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readTestEvidence } from "./test-evidence.js";

const RUN_ID = "iterate-2026-08-11-evidence";

describe("readTestEvidence", () => {
  it("accepts only an immutable snapshot bound to the same Mission run", () => {
    const root = mkdtempSync(join(tmpdir(), "mission-evidence-"));
    try {
      const dir = join(root, ".shipwright", "agent_docs", "iterates");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${RUN_ID}.test-results.json`), JSON.stringify({ iterate_latest: { run_id: RUN_ID, test_completeness: { status: "complete", behaviors: [{ behavior: "Mission detail is readable", disposition: "tested" }, { behavior: "manual", disposition: "untestable" }], counts: { tested: 1, testable: 1, untested_testable: 0 } } } }));
      expect(readTestEvidence(root, RUN_ID)).toEqual({ status: "available", verifiedBehaviors: ["Mission detail is readable"], completeness: { tested: 1, testable: 1, untestedTestable: 0 }, note: null });
      writeFileSync(join(dir, `${RUN_ID}.test-results.json`), JSON.stringify({ iterate_latest: { run_id: "iterate-other", test_completeness: { behaviors: [] } } }));
      expect(readTestEvidence(root, RUN_ID).status).toBe("unavailable");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("degrades inconsistent or partial completeness evidence, but accepts legitimate n/a", () => {
    const root = mkdtempSync(join(tmpdir(), "mission-evidence-"));
    try {
      const dir = join(root, ".shipwright", "agent_docs", "iterates");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${RUN_ID}.test-results.json`);
      writeFileSync(file, JSON.stringify({ iterate_latest: { run_id: RUN_ID, test_completeness: { status: "complete", behaviors: [{ behavior: "one", disposition: "tested" }], counts: { tested: 9, testable: 1, untested_testable: 0 } } } }));
      expect(readTestEvidence(root, RUN_ID)).toMatchObject({ status: "unavailable", note: "The per-run test-completeness counts are inconsistent." });
      writeFileSync(file, JSON.stringify({ iterate_latest: { run_id: RUN_ID, test_completeness: { status: "partial", behaviors: [], counts: { tested: 0, testable: 0, untested_testable: 0 } } } }));
      expect(readTestEvidence(root, RUN_ID)).toMatchObject({ status: "unavailable", note: "The per-run test evidence is incomplete." });
      writeFileSync(file, JSON.stringify({ iterate_latest: { run_id: RUN_ID, test_completeness: { status: "n/a", behaviors: [] } } }));
      expect(readTestEvidence(root, RUN_ID)).toEqual({ status: "available", verifiedBehaviors: [], completeness: null, note: "This run recorded no testable behaviours." });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps valid evidence with more than twelve tested behaviours", () => {
    const root = mkdtempSync(join(tmpdir(), "mission-evidence-"));
    try {
      const dir = join(root, ".shipwright", "agent_docs", "iterates");
      mkdirSync(dir, { recursive: true });
      const behaviors = Array.from({ length: 13 }, (_, index) => ({ behavior: `Behaviour ${index + 1}`, disposition: "tested" }));
      writeFileSync(join(dir, `${RUN_ID}.test-results.json`), JSON.stringify({ iterate_latest: { run_id: RUN_ID, test_completeness: { status: "complete", behaviors, counts: { tested: 13, testable: 13, untested_testable: 0 } } } }));
      expect(readTestEvidence(root, RUN_ID)).toMatchObject({ status: "available", completeness: { tested: 13, testable: 13, untestedTestable: 0 } });
      expect(readTestEvidence(root, RUN_ID).verifiedBehaviors).toHaveLength(12);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
