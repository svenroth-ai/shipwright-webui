import { existsSync } from "node:fs";
import path from "node:path";

import { readBoundedFile } from "./fs-read.js";
import { pathGuard } from "../path-guard.js";

export interface TestEvidence {
  status: "available" | "unavailable";
  verifiedBehaviors: string[];
  completeness: { tested: number; testable: number; untestedTestable: number } | null;
  note: string | null;
}

const MAX_BYTES = 1024 * 1024;

/** Read only the immutable F5c snapshot for this exact Mission run. */
export function readTestEvidence(projectRoot: string, runId: string): TestEvidence {
  const rel = [".shipwright", "agent_docs", "iterates", `${runId}.test-results.json`].join("/");
  const guard = pathGuard(projectRoot, rel);
  if (!guard.ok || !existsSync(guard.absolute)) {
    return { status: "unavailable", verifiedBehaviors: [], completeness: null, note: "The per-run test evidence is not available." };
  }
  const read = readBoundedFile(guard.absolute, MAX_BYTES);
  if (!read) return { status: "unavailable", verifiedBehaviors: [], completeness: null, note: "The per-run test evidence could not be read." };
  try {
    const parsed = JSON.parse(read.text) as { iterate_latest?: { run_id?: unknown; test_completeness?: { status?: unknown; behaviors?: unknown; counts?: { tested?: unknown; testable?: unknown; untested_testable?: unknown } } } };
    const latest = parsed.iterate_latest;
    const completenessRecord = latest?.test_completeness;
    if (latest?.run_id !== runId || !completenessRecord) {
      return { status: "unavailable", verifiedBehaviors: [], completeness: null, note: "The per-run test evidence could not be matched to this Mission." };
    }
    if (completenessRecord.status === "n/a") {
      return { status: "available", verifiedBehaviors: [], completeness: null, note: "This run recorded no testable behaviours." };
    }
    if (completenessRecord.status !== "complete" || !Array.isArray(completenessRecord.behaviors)) {
      return { status: "unavailable", verifiedBehaviors: [], completeness: null, note: "The per-run test evidence is incomplete." };
    }
    const behaviors = completenessRecord.behaviors;
    const isBehavior = (entry: unknown): entry is { behavior: string; disposition: "tested" | "untestable" } => Boolean(entry) && typeof entry === "object" && typeof (entry as { behavior?: unknown }).behavior === "string" && (entry as { behavior: string }).behavior.trim().length > 0 && ((entry as { disposition?: unknown }).disposition === "tested" || (entry as { disposition?: unknown }).disposition === "untestable");
    if (!behaviors.every(isBehavior)) {
      return { status: "unavailable", verifiedBehaviors: [], completeness: null, note: "The per-run test evidence contains malformed behaviours." };
    }
    const allVerifiedBehaviors = behaviors.filter((entry) => entry.disposition === "tested").map((entry) => entry.behavior);
    const verifiedBehaviors = allVerifiedBehaviors.slice(0, 12);
    const counts = completenessRecord.counts;
    const nonNegativeInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
    const completeness = counts && nonNegativeInteger(counts.tested) && nonNegativeInteger(counts.testable) && nonNegativeInteger(counts.untested_testable) && counts.tested <= counts.testable && counts.tested + counts.untested_testable === counts.testable && counts.tested === allVerifiedBehaviors.length
      ? { tested: counts.tested, testable: counts.testable, untestedTestable: counts.untested_testable }
      : null;
    if (!completeness) {
      return { status: "unavailable", verifiedBehaviors: [], completeness: null, note: "The per-run test-completeness counts are inconsistent." };
    }
    return { status: "available", verifiedBehaviors, completeness, note: null };
  } catch {
    return { status: "unavailable", verifiedBehaviors: [], completeness: null, note: "The per-run test evidence is malformed." };
  }
}

export function testEvidencePath(projectRoot: string, runId: string): string {
  return path.join(projectRoot, ".shipwright", "agent_docs", "iterates", `${runId}.test-results.json`);
}
