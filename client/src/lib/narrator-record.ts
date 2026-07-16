/*
 * narrator-record.ts — "The Record" spine narration (FR-01.54, A10, campaign
 * webui-wow-usability-2026-07-10).
 *
 * Split out of narrator.ts so both stay well under the file-size cap. Pure and
 * deterministic: derives each node's short receipt HONESTLY from the run facts
 * A01/A02 read (affected FRs, spec impact, tests, derived review gate, commit)
 * and pairs it with its verbatim caption from narrator-strings.ts. An absent
 * fact degrades to an explicit `n/a` — never a fabricated value (AC3). Re-export
 * surface lives on narrator.ts, so consumers import from a single module.
 */

import {
  NA,
  RECORD_CAPTIONS,
  RECORD_LABELS,
  type RecordNodeKey,
} from "./narrator-strings";

export type GateState = "pass" | "fail" | "unknown";

/** Structural mirror of the A02 `RunDataJoin` fields the Record consumes (a
 *  local input type, never a cross-package import — ADR-080). */
export interface RunFactsLike {
  affectedFrs?: string[] | null;
  /** spec_impact normalized to lowercase (add | modify | none | null). */
  specImpact?: string | null;
  tests?: { passed: number | null; total: number | null } | null;
  gates?: { review?: GateState } | null;
  commit?: string | null;
}

export interface RecordNode {
  key: RecordNodeKey;
  label: string;
  receipt: string;
  caption: string;
}

function specReceipt(specImpact?: string | null): string {
  switch (specImpact) {
    case "add":
      return "added";
    case "modify":
      return "updated";
    case "none":
      return "unchanged";
    default:
      return NA;
  }
}

function testsReceipt(tests?: RunFactsLike["tests"]): string {
  if (tests && tests.passed != null && tests.total != null) {
    return `${tests.passed}/${tests.total}`;
  }
  return NA;
}

function testsCaption(tests?: RunFactsLike["tests"]): string {
  if (tests && tests.passed != null && tests.total != null) {
    const verb = tests.passed === tests.total ? "green" : "passing";
    return `Suite ${tests.passed}/${tests.total} ${verb}.`;
  }
  return `Suite ${NA}.`;
}

function reviewReceipt(gate?: GateState): string {
  if (gate === "pass") return "clean";
  if (gate === "fail") return "held";
  return NA;
}

/** The Record spine: five nodes (requirement / spec / tests / review /
 *  commit), each with a receipt derived honestly from the run facts and a
 *  verbatim caption. Absent facts degrade to `n/a`. */
export function narrateRecord(facts: RunFactsLike): RecordNode[] {
  const fr = facts.affectedFrs?.[0] ?? NA;
  const commit = facts.commit ? facts.commit.slice(0, 7) : NA;
  return [
    { key: "req", label: RECORD_LABELS.req, receipt: fr, caption: RECORD_CAPTIONS.req },
    {
      key: "spec",
      label: RECORD_LABELS.spec,
      receipt: specReceipt(facts.specImpact),
      caption: RECORD_CAPTIONS.spec,
    },
    {
      key: "tests",
      label: RECORD_LABELS.tests,
      receipt: testsReceipt(facts.tests),
      caption: testsCaption(facts.tests),
    },
    {
      key: "review",
      label: RECORD_LABELS.review,
      receipt: reviewReceipt(facts.gates?.review),
      caption: RECORD_CAPTIONS.review,
    },
    {
      key: "commit",
      label: RECORD_LABELS.commit,
      receipt: commit,
      caption: RECORD_CAPTIONS.commit,
    },
  ];
}
