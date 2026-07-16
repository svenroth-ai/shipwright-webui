/*
 * narrator.ts — deterministic event → plain-language mapping for Mission
 * Control (FR-01.54, A10, campaign webui-wow-usability-2026-07-10).
 *
 * A pure, side-effect-free library: the same event always yields the same
 * sentence. It maps the facts A01/A02 read from the event log (per-run FRs,
 * test counts, derived gates, spec impact, commit) plus the two rails onto the
 * approved copy in narrator-strings.ts. It NEVER invents a number, count,
 * outcome or duration it did not read — an absent field degrades to an explicit
 * `n/a` or the clause is dropped (honest degradation, AC3); every value
 * narrated is a reader/derivable fact from A01/A02 (provenance honesty, AC4).
 * Two rails, different in kind: the Pipeline rail is
 * the real 7 orchestrator phases (project → design → plan → build → test →
 * changelog → deploy — NO secure node, security is CI-sourced), the Iterate
 * rail is a 5-node DISPLAY grouping DERIVED from sessionPlan.phases[].group.
 */

import {
  ITERATE_GROUP_LABELS,
  ITERATE_GROUP_ORDER,
  MISSION,
  PIPELINE_PHASE_DEFS,
  VERDICT,
  VERDICT_JOIN,
  type IterateGroupId,
  type PipelinePhaseId,
} from "./narrator-strings";

export {
  SECURITY_IS_PIPELINE_PHASE,
  SECURITY_LAMP_SOURCE,
  ITERATE_GROUP_ORDER,
  ITERATE_GROUP_LABELS,
  type PipelinePhaseId,
  type IterateGroupId,
  type RecordNodeKey,
} from "./narrator-strings";

/* ---- Pipeline rail ---------------------------------------------------- */

export interface PipelineRailNode {
  id: PipelinePhaseId;
  label: string;
  gloss: string;
}

export interface PipelineRailOptions {
  /** Deploy phase gloss variant. Defaults to the "ship to the web" wording. */
  deployTarget?: "web" | "local";
}

/** The 7-node pipeline rail. Deterministic; never includes a secure node. */
export function buildPipelineRail(
  opts: PipelineRailOptions = {},
): PipelineRailNode[] {
  return PIPELINE_PHASE_DEFS.map((def) => ({
    id: def.id,
    label: def.label,
    gloss:
      def.id === "deploy" && opts.deployTarget === "local" && def.glossLocal
        ? def.glossLocal
        : def.gloss,
  }));
}

/** The plain-language line for a single pipeline phase, or null if the id is
 *  not one of the 7 real phases (e.g. "secure" — never narrated as a phase). */
export function narratePipelinePhase(
  id: string,
  opts: PipelineRailOptions = {},
): PipelineRailNode | null {
  return buildPipelineRail(opts).find((n) => n.id === id) ?? null;
}

/** True only for the 7 real orchestrator phases. Security is CI-sourced, so
 *  `isPipelinePhase("secure")` / `("security")` are false by construction. */
export function isPipelinePhase(id: string): boolean {
  return PIPELINE_PHASE_DEFS.some((def) => def.id === id);
}

/* ---- Iterate rail (derived 5-node grouping) --------------------------- */

export interface IteratePhaseInput {
  id: string;
  group: string;
}

export interface IterateRailNode {
  group: string;
  label: string;
  /** The real phases folded into this display group, in input order. */
  phases: string[];
}

/** Only canonical groups ever reach here (both callers gate on
 *  ITERATE_GROUP_ORDER), so this is a pure lookup — no capitalize fallback. */
function groupLabel(group: IterateGroupId): string {
  return ITERATE_GROUP_LABELS[group];
}

/**
 * Fold the ~20 real gated phases onto the display rail, DERIVING each node's
 * membership from `sessionPlan.phases[].group` — never from a hardcoded phase
 * list. The rail is limited to the authoritative iterate display groups
 * (data.js iterateGroups): a group the plan actually contains becomes a node
 * (a partial plan yields fewer), ORDERED by the canonical order so a re-ordered
 * or interleaved plan can never mis-order the rail; a stray/unknown group
 * (e.g. a "secure" group) is NEVER injected as an extra node — the iterate rail
 * has no more than the five Scope/Build/Review/Test/Finalize nodes, and
 * security is never one of them. Feeding the 10-phase real plan yields exactly
 * the 5 display groups.
 */
export function buildIterateRail(
  phases: readonly IteratePhaseInput[],
): IterateRailNode[] {
  const byGroup = new Map<IterateGroupId, IterateRailNode>();
  for (const phase of phases) {
    if (!ITERATE_GROUP_ORDER.includes(phase.group as IterateGroupId)) continue;
    const group = phase.group as IterateGroupId;
    let node = byGroup.get(group);
    if (!node) {
      node = { group, label: groupLabel(group), phases: [] };
      byGroup.set(group, node);
    }
    node.phases.push(phase.id);
  }
  return [...byGroup.values()].sort(
    (a, b) =>
      ITERATE_GROUP_ORDER.indexOf(a.group as IterateGroupId) -
      ITERATE_GROUP_ORDER.indexOf(b.group as IterateGroupId),
  );
}

/** The display group a single iterate phase belongs to, or `null` for a
 *  non-canonical group — matching `buildIterateRail`'s guarantee that only the
 *  five Scope/Build/Review/Test/Finalize groups exist (a stray "secure" group
 *  is never labelled, never surfaced). */
export function narrateIteratePhase(
  phase: IteratePhaseInput,
): { group: IterateGroupId; label: string } | null {
  if (!ITERATE_GROUP_ORDER.includes(phase.group as IterateGroupId)) return null;
  const group = phase.group as IterateGroupId;
  return { group, label: groupLabel(group) };
}

/* ---- Verdict banner --------------------------------------------------- */

export interface VerdictTests {
  passed: number | null;
  total: number | null;
}

export type VerdictInput =
  | { outcome: "clear"; tests?: VerdictTests | null }
  | { outcome: "hold"; detail?: string | null };

export interface Verdict {
  outcome: "clear" | "hold";
  /** Badge text — "ALL CLEAR" (styled ok) or "GATE HOLD" (styled red). */
  head: string;
  /** Descriptive body; the composed banner is `composeVerdict(v)`. */
  body: string;
}

/** The verdict banner, split into the styled badge (`head`) and the
 *  descriptive `body` so A11–A13 render the badge without re-splitting a flat
 *  string. Honest degradation: an unknown test count drops the tests clause;
 *  an unknown hold detail drops the detail clause. */
export function narrateVerdict(input: VerdictInput): Verdict {
  if (input.outcome === "hold") {
    const detail = input.detail?.trim();
    const body = detail
      ? `${VERDICT.holdBodyLead} · ${detail} — ${VERDICT.holdTail}`
      : `${VERDICT.holdBodyLead} — ${VERDICT.holdTail}`;
    return { outcome: "hold", head: VERDICT.holdHead, body };
  }
  const t = input.tests;
  const known = t != null && t.passed != null && t.total != null;
  const body = known
    ? `${VERDICT.clearBodyLead} · ${t!.passed}/${t!.total} tests · ${VERDICT.clearReview}`
    : `${VERDICT.clearBodyLead} · ${VERDICT.clearReview}`;
  return { outcome: "clear", head: VERDICT.clearHead, body };
}

/** The verbatim flat banner (`${head} — ${body}`) for an aria-label / plain
 *  render; the styled surfaces use `head` + `body` directly. */
export function composeVerdict(v: Verdict): string {
  return `${v.head}${VERDICT_JOIN}${v.body}`;
}

/* ---- Mission lines ---------------------------------------------------- */

export type MissionInput =
  | {
      state: "complete";
      changeCount?: number | null;
      fileCount?: number | null;
      allGreen?: boolean;
    }
  | { state: "hold" }
  | { state: "designgate"; screenCount?: number | null };

export interface MissionLine {
  text: string;
  emphasis: string;
}

function countClause(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function completeEmphasis(
  changeCount?: number | null,
  fileCount?: number | null,
  allGreen?: boolean,
): string {
  const parts: string[] = [];
  if (changeCount != null) parts.push(countClause(changeCount, "change", "changes"));
  if (fileCount != null) parts.push(countClause(fileCount, "file", "files"));
  if (allGreen) parts.push(MISSION.completeGreen);
  return parts.join(", ");
}

/** The mission line + emphasis. Honest degradation: absent counts are omitted
 *  (never fabricated), "every check green" only appears when read as true, and
 *  a design gate without a screen count drops the number. */
export function narrateMission(input: MissionInput): MissionLine {
  if (input.state === "hold") {
    return { text: MISSION.holdLead, emphasis: MISSION.holdEmphasis };
  }
  if (input.state === "designgate") {
    const n = input.screenCount;
    const text =
      n == null
        ? MISSION.designLeadNoCount
        : `${n} ${n === 1 ? MISSION.designLeadSingular : MISSION.designLeadPlural}`;
    return { text, emphasis: MISSION.designEmphasis };
  }
  return {
    text: MISSION.completeLead,
    emphasis: completeEmphasis(input.changeCount, input.fileCount, input.allGreen),
  };
}

/* ---- The Record (own module: narrator-record.ts) ---------------------- */

export {
  narrateRecord,
  type GateState,
  type RunFactsLike,
  type RecordNode,
} from "./narrator-record";
