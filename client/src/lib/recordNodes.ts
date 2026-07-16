/*
 * recordNodes.ts — "The Record" spine: HONEST done/now/pending derivation
 * (FR-01.55, A11, campaign webui-wow-usability-2026-07-10).
 *
 * Pure + deterministic. Turns the run facts A02 reports (RunDataJoin) plus the
 * Mission state into the five (or, at a design gate, six) Record nodes the rail
 * renders. Every LABEL + RECEIPT comes from A10's narrator (narrateRecord /
 * narratePipelinePhase) — there is NO second vocabulary here.
 *
 * Fable B3 (an AC, not a nicety): the prototype's Record LIES mid-run — it shows
 * "Review — clean" while the Operation is a GATE HOLD, and the commit receipt
 * falls back to the literal string "feat". This module fixes that:
 *   - node state is derived from what A02 ACTUALLY reports, never an index
 *     constant;
 *   - a node with no evidence renders `pending` with NO receipt (null), never a
 *     fabricated one;
 *   - a failing review gate → Review is `now`/"held", never `done`/"clean";
 *   - a run with no commit → Commit is `pending` with no sha (never "feat");
 *   - a design-gate run shows a Design node as `now` — it does not skip ahead.
 */

import {
  narratePipelinePhase,
  narrateRecord,
  type RecordNode,
  type RecordNodeKey,
  type RunFactsLike,
} from "./narrator";
import { NA } from "./narrator-strings";

/** The three Mission states (see useMissionState). Re-exported so the Record
 *  layer has one import surface. */
export type MissionState = "done" | "live" | "designgate";

export type RecordNodeState = "done" | "now" | "pending";

/** A Record node ready to render. `receipt: null` means render NO receipt line
 *  (honest empty — never a fabricated value). There are ALWAYS exactly five
 *  nodes (AC1); at a design gate the `spec` node is presented as the "Design"
 *  step (its label/caption swap, key unchanged) rather than a sixth node. */
export interface RecordNodeView {
  key: RecordNodeKey;
  label: string;
  receipt: string | null;
  caption: string;
  state: RecordNodeState;
}

export interface DeriveRecordInput {
  missionState: MissionState;
  /** A02's per-run join (RunDataJoin-shaped), or null when the task joins to no
   *  run — in which case every node degrades to `pending` with no receipt. */
  facts: RunFactsLike | null;
}

/** Canonical node order — the audit trail. */
const NODE_ORDER: RecordNodeKey[] = ["req", "spec", "tests", "review", "commit"];

/** Per-node "is this step evidently COMPLETE?" — derived from real facts only. */
function completionFlags(facts: RunFactsLike): Record<RecordNodeKey, boolean> {
  const tests = facts.tests;
  return {
    req: (facts.affectedFrs?.length ?? 0) > 0,
    spec: facts.specImpact != null,
    // tests are "done" only when the suite is fully green; present-but-red is
    // NOT complete (it stays the active frontier mid-run).
    tests: tests != null && tests.passed != null && tests.total != null && tests.passed === tests.total,
    // a DERIVED gate: only an explicit pass counts; "fail"/"unknown" are not done.
    review: facts.gates?.review === "pass",
    commit: facts.commit != null && facts.commit.length > 0,
  };
}

/** Collapse a narrator receipt + a resolved state into what actually renders:
 *  a `pending` node shows nothing, and an `n/a` receipt is never displayed. */
function displayReceipt(receipt: string, state: RecordNodeState): string | null {
  if (state === "pending") return null;
  if (receipt === NA) return null;
  return receipt;
}

function finalize(base: RecordNode, state: RecordNodeState): RecordNodeView {
  return {
    key: base.key,
    label: base.label,
    caption: base.caption,
    state,
    receipt: displayReceipt(base.receipt, state),
  };
}

/** The design-gate variant — still EXACTLY five nodes (AC1). Requirement derives
 *  honestly; the `spec` node is presented as the "Design" step and is the `now`
 *  frontier (the design/spec phase is the active work at the gate); nothing
 *  downstream (tests/review/commit) can be done — nothing is built during a
 *  design gate, so they are `pending` with no fabricated receipt. It does NOT
 *  skip ahead to Review. */
function designGateNodes(
  base: RecordNode[],
  done: Record<RecordNodeKey, boolean>,
): RecordNodeView[] {
  const design = narratePipelinePhase("design");
  return base.map((n) => {
    if (n.key === "req") return finalize(n, done.req ? "done" : "pending");
    if (n.key === "spec") {
      return {
        key: "spec",
        label: design?.label ?? "Design",
        caption: design?.gloss ?? n.caption,
        receipt: null,
        state: "now",
      };
    }
    return finalize(n, "pending"); // tests / review / commit
  });
}

/**
 * The Record spine, honestly state-derived. `done` mission → completed nodes
 * are `done`, the rest `pending` (no active frontier). `live` mission → the
 * first incomplete node is the `now` frontier (a failing review lands here as
 * "held", never "clean"). `designgate` → a Design node is `now`.
 */
export function deriveRecordNodes(input: DeriveRecordInput): RecordNodeView[] {
  const facts = input.facts ?? {};
  const base = narrateRecord(facts);
  const done = completionFlags(facts);

  if (input.missionState === "designgate") {
    return designGateNodes(base, done);
  }

  // The active frontier: the first not-yet-complete node, but only while the
  // run is live. A completed run has no `now`.
  const nowKey =
    input.missionState === "live"
      ? NODE_ORDER.find((k) => !done[k]) ?? null
      : null;

  return base.map((n) => {
    const state: RecordNodeState = done[n.key] ? "done" : n.key === nowKey ? "now" : "pending";
    return finalize(n, state);
  });
}
