/*
 * narrator-strings.ts — the approved copy-of-record, verbatim (FR-01.54, A10,
 * campaign webui-wow-usability-2026-07-10).
 *
 * This module is DATA ONLY: the plain-language strings the narrator maps
 * events onto, lifted byte-for-byte from the clickable prototype (the design
 * SSoT — the old "wording-go" human gate is retired, the prototype's strings
 * ARE the approved wording):
 *   - pipeline phase labels + glosses → Spec/prototype/screens/wizard.js planCard()
 *   - iterate group labels            → Spec/prototype/data.js iterateGroups /
 *                                        sessionPlan.phases[].group
 *   - verdict + mission fragments     → Spec/prototype/screens/taskDetail.js
 *   - The Record labels + captions    → Spec/prototype/screens/taskDetail.js nodes()
 *
 * Special characters are the prototype's real code points — curly quotes
 * (U+201C/U+201D), right single quote (U+2019), em dash (U+2014), rightwards
 * arrow (U+2192), middle dot (U+00B7). The narrator NEVER paraphrases these;
 * narrator.test.ts pins them against independent literals.
 *
 * Kept separate from narrator.ts so the logic module stays under the file-size
 * cap without ratcheting the bloat baseline (library-only, no UI change).
 */

/** Explicit degraded value — honest degradation renders this, never a guess. */
export const NA = "n/a";

/* ---- Pipeline rail — 7 phases, NO secure node ------------------------- */

export type PipelinePhaseId =
  | "project"
  | "design"
  | "plan"
  | "build"
  | "test"
  | "changelog"
  | "deploy";

export interface PipelinePhaseDef {
  id: PipelinePhaseId;
  label: string;
  /** Primary gloss (deploy: the "ship to the web" variant). */
  gloss: string;
  /** Deploy only: the local-run variant. */
  glossLocal?: string;
}

/**
 * The real, 7-phase pipeline: project → design → plan → build → test →
 * changelog → deploy. Order + labels + glosses are verbatim from wizard.js.
 * There is deliberately NO "secure" node — security is decoupled and
 * CI/compliance-sourced (see SECURITY_LAMP_SOURCE), not an orchestrator phase.
 */
export const PIPELINE_PHASE_DEFS: readonly PipelinePhaseDef[] = [
  {
    id: "project",
    label: "Project",
    gloss: "First I write down what “done” means — that’s your spec.",
  },
  {
    id: "design",
    label: "Design",
    gloss: "I mock the screens so you can approve the look before code exists.",
  },
  {
    id: "plan",
    label: "Plan",
    gloss: "I break the work into small, testable pieces.",
  },
  {
    id: "build",
    label: "Build",
    gloss: "Tests first (they prove it works), then the code to pass them.",
  },
  {
    id: "test",
    label: "Test",
    gloss: "The full suite runs — the red→green moment is the proof.",
  },
  {
    id: "changelog",
    label: "Changelog",
    gloss: "Every change is written up so the record stays honest.",
  },
  {
    id: "deploy",
    label: "Deploy",
    gloss: "I ship it to the web (I’ll ask for env vars here).",
    glossLocal: "Skipped — it runs on your machine for now.",
  },
];

/**
 * Security is sourced from CI / compliance (ci-security.json), NOT the
 * orchestrator's phase set — it is intentionally absent from the pipeline
 * rail. A11–A13 render the security lamp from this source and must label it
 * as such.
 */
export const SECURITY_LAMP_SOURCE = "ci-security.json" as const;
export const SECURITY_IS_PIPELINE_PHASE = false as const;

/* ---- Iterate rail — 5-node display grouping --------------------------- */

export type IterateGroupId = "scope" | "build" | "review" | "test" | "finalize";

/** Canonical display order (matches data.js iterateGroups). */
export const ITERATE_GROUP_ORDER: readonly IterateGroupId[] = [
  "scope",
  "build",
  "review",
  "test",
  "finalize",
];

export const ITERATE_GROUP_LABELS: Record<IterateGroupId, string> = {
  scope: "Scope",
  build: "Build",
  review: "Review",
  test: "Test",
  finalize: "Finalize",
};

/* ---- The Record — node labels + verbatim captions --------------------- */

export type RecordNodeKey = "req" | "spec" | "tests" | "review" | "commit";

export const RECORD_LABELS: Record<RecordNodeKey, string> = {
  req: "Requirement",
  spec: "Spec",
  tests: "Tests",
  review: "Review",
  commit: "Commit",
};

/** Static captions (verbatim). The tests caption carries a count slot and is
 *  assembled in narrator.ts so honest degradation can drop the number. */
export const RECORD_CAPTIONS: Record<Exclude<RecordNodeKey, "tests">, string> = {
  req: "Everything below must trace to this requirement — or the change does not ship. This is the anchor of the audit trail.",
  spec: "The written definition of “done”, diffed on this run.",
  review: "The verdict that let the change proceed.",
  commit: "Spec · changelog · decision log moved in lockstep.",
};

/* ---- Verdict + mission fragments (verbatim) --------------------------- */

export const VERDICT = {
  clearHead: "ALL CLEAR — security",
  clearReview: "review clean",
  holdHead: "GATE HOLD — Security",
  holdTail: "fixing.",
} as const;

export const MISSION = {
  completeLead: "Done.",
  completeGreen: "every check green.",
  holdLead: "The security gate caught something.",
  holdEmphasis: "The change can’t ship until this is green.",
  designLeadPlural: "screens are ready for your eyes.",
  designLeadSingular: "screen is ready for your eyes.",
  designLeadNoCount: "Screens are ready for your eyes.",
  designEmphasis: "Nothing gets built until you approve.",
} as const;
