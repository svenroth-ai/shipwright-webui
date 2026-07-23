/*
 * missionArtifacts.ts — MissionContext → view mapping (CONTRACT §6 / §8).
 *
 * Pure + deterministic, so the rules that decide what a user sees are unit-
 * testable without a DOM.
 *
 * The HIDE-EMPTY rule is the whole point and it is deliberately asymmetric:
 *
 *   hidden  — `not_applicable`   this artifact does not apply to this run
 *             `not_yet_created`  it is expected LATER in the lifecycle
 *   shown   — `available`        clickable, with a summary
 *             `unavailable`      compact, NON-clickable "currently unavailable"
 *             `error`            same, as an error
 *
 * Why `unavailable` must stay visible: it means "this SHOULD exist and we could
 * not read it" — an unreadable event log, a pointer that failed validation.
 * Hiding it would let a data-integrity problem masquerade as "nothing exists",
 * which is exactly the class of lie the state model was introduced to kill.
 *
 * ONE exception, added 2026-07-21: while the run is LIVE (`context.runLive`),
 * `not_yet_created` means "not written YET", not "this run has no such
 * artifact" — so it is SHOWN, inert, as a pending entry. Without it the rail is
 * empty for the whole early phase of every run, which is precisely when the
 * operator is watching. `not_applicable` stays hidden either way, and
 * `unavailable` never becomes pending: a read failure must stay distinguishable
 * from "not written yet".
 */

import type {
  ArtifactDescriptor,
  ArtifactState,
  MissionContext,
} from "./missionContextApi";

/**
 * The rail order.
 *
 * CONTRACT §6's six iterate artifacts keep their decided order EXACTLY — S3 only
 * interleaves kinds that belong to other scenarios, and the kind sets are
 * disjoint, so a rail never mixes them. `phase` leads because for a pipeline
 * task it is the identity of the thing being looked at; the campaign kinds run
 * campaign-level first, then the single sub-iterate.
 */
export const ARTIFACT_ORDER: ArtifactDescriptor["kind"][] = [
  // pipeline (scenario 3)
  "phase",
  // `spec` serves three scenarios: the iterate spec, the pipeline's adopted
  // spec, and the campaign BRIEF. Each supplies its own label.
  "spec",
  // campaign (scenario 5) — campaign level, then the active unit
  "campaign_runbook",
  "campaign_progress",
  "sub_iterate",
  // iterate (scenario 2)
  "requirement",
  "tests",
  "review",
  "decisions",
  "commit",
];

/** The two "absent" states, hidden by hide-empty. Everything else renders. */
const HIDDEN_STATES: ReadonlySet<ArtifactState> = new Set<ArtifactState>([
  "not_applicable",
  "not_yet_created",
]);

export function isArtifactVisible(a: ArtifactDescriptor, runLive = false): boolean {
  if (runLive && a.state === "not_yet_created") return true;
  return !HIDDEN_STATES.has(a.state);
}

/** Does this artifact render as "waiting to be written" rather than as a link? */
export function isArtifactPending(a: ArtifactDescriptor, runLive: boolean): boolean {
  return runLive && a.state === "not_yet_created";
}

/** Only an `available` artifact opens the right panel; the rest are inert. */
export function isArtifactClickable(a: ArtifactDescriptor): boolean {
  return a.state === "available";
}

/**
 * The rail, in canonical order, with hide-empty applied. Unknown kinds from a
 * newer server are dropped rather than rendered in an arbitrary slot.
 */
export function visibleArtifacts(context: MissionContext | null | undefined): ArtifactDescriptor[] {
  if (!context) return [];
  const byKind = new Map(context.artifacts.map((a) => [a.kind, a]));
  const out: ArtifactDescriptor[] = [];
  // `runLive === true` is required explicitly: a server that does not send the
  // field (an older build) keeps today's hide-empty exactly.
  const live = context.runLive === true;
  for (const kind of ARTIFACT_ORDER) {
    const a = byKind.get(kind);
    if (a && isArtifactVisible(a, live)) out.push(a);
  }
  return out;
}

/**
 * Does this context drive the artifact rail at all?
 *
 * S1 admitted only `iterate`; S3 adds `pipeline` and `campaign` now that both
 * resolve natively (CONTRACT §10 Slice 3) rather than borrowing today's
 * `work_completed` rail.
 *
 * `plain` / `pure` are deliberately still excluded — those sessions have no
 * artifacts by definition, and the legacy rail is what they render (§4.5).
 * `custom_actions` never reaches here: its tab does not exist.
 *
 * The `artifacts.length > 0` guard is what makes this safe on a version skew —
 * a server that returns a scenario with an empty rail falls back to the legacy
 * one instead of rendering an empty panel.
 */
const CONTEXT_RAIL_SCENARIOS: ReadonlySet<string> = new Set(["iterate", "pipeline", "campaign"]);

export function usesContextRail(context: MissionContext | null | undefined): boolean {
  return Boolean(
    context && CONTEXT_RAIL_SCENARIOS.has(context.scenario) && context.artifacts.length > 0,
  );
}

/**
 * The scenario the S4 stage derivation is gated on.
 *
 * `custom_actions` maps to `plain`, NOT to the `null` unresolved sentinel: those
 * mean opposite things. `null` is "the resolver has not answered" and takes the
 * lifecycle branch; `custom_actions` is a POSITIVE finding that this card is not
 * an iterate. Routing it through `null` ran that asymmetry backwards. Mostly
 * unreachable (the scenario hides the tab) — but the same AC keeps the tab
 * SHOWING for every *ambiguous* actions file, so it was never fully mitigated.
 */
export function stageScenario(
  context: MissionContext | null | undefined,
): "iterate" | "pipeline" | "campaign" | "plain" | null {
  const s = context?.scenario;
  if (!s) return null;
  return s === "custom_actions" ? "plain" : s;
}

/**
 * The pipeline task's AUTHORITATIVE run-config phase, for the S4 stage
 * derivation — or null when this is not a pipeline context / the phase was not
 * resolved.
 *
 * Lives here, next to the other context→view readers, so no COMPONENT ever
 * handles a raw phase string (DO-NOT #11). Returning null on an unreadable phase
 * is load-bearing: the caller renders an honest "—" rather than falling back to
 * the tool-signal guess the run-config phase exists to replace.
 */
export function pipelinePhase(context: MissionContext | null | undefined): string | null {
  if (!context || context.scenario !== "pipeline") return null;
  const phase = context.artifacts.find((a) => a.kind === "phase");
  if (!phase || phase.kind !== "phase") return null;
  const value = phase.detail?.phase;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A newer/unknown schema is refused rather than misread (external-review GPT #15). */
export function isSupportedSchema(context: MissionContext | null | undefined): boolean {
  return Boolean(context && context.schemaVersion === 1);
}

/** Screen-reader / tooltip phrase for a non-available artifact. */
export function artifactStateWord(state: ArtifactState): string {
  switch (state) {
    case "available":
      return "available";
    case "unavailable":
      return "currently unavailable";
    case "error":
      return "could not be loaded";
    case "not_applicable":
      return "not applicable";
    case "not_yet_created":
      return "not created yet";
  }
}

/**
 * The Tests chip value (`passed/total`), or null when truly absent.
 *
 * NEVER fabricates: a partial record (a total with no passed count) yields null
 * so the chip shows an honest "—" rather than an invented denominator.
 */
export function testsChipValue(context: MissionContext | null | undefined): string | null {
  const t = context?.tests;
  if (!t || t.passed == null || t.total == null) return null;
  return `${t.passed}/${t.total}`;
}

/** The Serves chip value — the FIRST fold-resolved FR id, or null. */
export function servesChipValue(context: MissionContext | null | undefined): string | null {
  const v = context?.servesFrId;
  return v && v.length > 0 ? v : null;
}

/**
 * The Tests DETAIL headline, from the pass/total the run recorded —
 * "All 42 tests passing" / "40 of 42 tests passing" / "42 tests recorded".
 *
 * Mirrors the server's `resultsSentence` wording (artifacts-tests.ts) so the
 * rail receipt and the panel headline never teach different things. Returns
 * null when nothing citable was recorded, so the caller shows the file table
 * (or a plain note) alone.
 */
export function testsResultText(
  results: { passed: number | null; total: number | null } | null | undefined,
): string | null {
  if (!results) return null;
  const { passed, total } = results;
  // A genuine zero-of-zero is not a result — never render "All 0 tests passing".
  if ((passed ?? 0) === 0 && (total ?? 0) === 0) return null;
  const word = (n: number): string => (n === 1 ? "test" : "tests");
  if (passed != null && total != null) {
    return passed === total
      ? `All ${total} ${word(total)} passing`
      : `${passed} of ${total} ${word(total)} passing`;
  }
  if (total != null) return `${total} ${word(total)} recorded`;
  if (passed != null) return `${passed} ${word(passed)} passing`;
  return null;
}

/** "FR-01.28 — Embedded terminal (mapped from FR-01.44)" for the detail rows. */
export function frRowLabel(row: {
  displayFrId: string;
  name: string | null;
  mappedFrom: string | null;
}): string {
  const base = row.name ? `${row.displayFrId} — ${row.name}` : row.displayFrId;
  return row.mappedFrom ? `${base} (mapped from ${row.mappedFrom})` : base;
}

/**
 * "FR-01.28 (mapped from FR-01.44)" for a TEST's requirement link (Slice-2 AC2).
 *
 * Same phrasing as `frRowLabel` on purpose — the fold provenance must read
 * identically wherever it appears, or the two surfaces teach different things.
 */
export function testFrLabel(fr: { frId: string; mappedFrom: string | null }): string {
  return fr.mappedFrom ? `${fr.frId} (mapped from ${fr.mappedFrom})` : fr.frId;
}

/** Past-tense verb for a test change — plain words, not git status letters. */
export function testChangeWord(kind: "added" | "modified" | "removed"): string {
  return kind === "added" ? "added" : kind === "removed" ? "removed" : "changed";
}

/** `e2e` is jargon; the panel says what the layer MEANS. */
export function layerWord(layer: string | null): string {
  if (!layer) return "unknown layer";
  if (layer === "e2e") return "end-to-end";
  if (layer === "unit") return "unit";
  if (layer === "integration") return "integration";
  return layer;
}

/** Plain-language name for each of the four review passes. */
export function reviewTypeLabel(
  t: "self" | "plan" | "code" | "doubt" | "external_code",
): string {
  switch (t) {
    case "self":
      return "Self-review";
    case "plan":
      return "Plan review";
    case "code":
      return "Code review";
    case "doubt":
      return "Doubt review";
    case "external_code":
      return "External code review";
  }
}
