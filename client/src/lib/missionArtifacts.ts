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
 */

import type {
  ArtifactDescriptor,
  ArtifactState,
  MissionContext,
} from "./missionContextApi";

/** The rail order — all six of CONTRACT §6, in the decided order. */
export const ARTIFACT_ORDER: ArtifactDescriptor["kind"][] = [
  "spec",
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

export function isArtifactVisible(a: ArtifactDescriptor): boolean {
  return !HIDDEN_STATES.has(a.state);
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
  for (const kind of ARTIFACT_ORDER) {
    const a = byKind.get(kind);
    if (a && isArtifactVisible(a)) out.push(a);
  }
  return out;
}

/**
 * Does this context drive the artifact rail at all?
 *
 * ONLY a resolved iterate does. Scenarios 1/3/4/5 keep today's behaviour
 * verbatim (the existing `work_completed` rail + campaign progress), so Slice 1
 * is additive and cannot regress them.
 */
export function usesContextRail(context: MissionContext | null | undefined): boolean {
  return Boolean(context && context.scenario === "iterate" && context.artifacts.length > 0);
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
export function reviewTypeLabel(t: "plan" | "code" | "doubt" | "external_code"): string {
  switch (t) {
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

/**
 * The review status, in words.
 *
 * `unavailable` deliberately reads as "no record" and NEVER as "passed" or
 * "none" — an unreadable pass presented as a clean one is the single worst
 * failure this artifact could produce (CONTRACT §9.1).
 */
export function reviewStatusWord(status: "completed" | "not_run" | "unavailable"): string {
  switch (status) {
    case "completed":
      return "ran";
    case "not_run":
      return "not run";
    case "unavailable":
      return "no record";
  }
}
