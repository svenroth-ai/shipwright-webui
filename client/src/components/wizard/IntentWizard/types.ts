/*
 * Intent-Wizard shared types (A08, FR-01.51).
 *
 * ReportModel / DimensionView / DimensionProvenance mirror the shipwright-grade
 * plugin dataclasses FIELD-FOR-FIELD (plugins/shipwright-grade/scripts/lib/
 * report_model.py). That model is a documented CROSS-REPO CONTRACT: grade.py
 * emits `json.dumps(dataclasses.asdict(model))` and this screen renders it, so a
 * field renamed in the monorepo must not silently half-render here. `reportShape.ts`
 * validates the payload before we trust it; a monorepo triage item tracks the
 * reciprocal obligation (the skill must not drop a field without a WebUI note).
 *
 * A08 is UI-only: the grade + adopt data is a STUB (stubData.ts), tagged with a
 * `provenance` marker and rendered as an explicit placeholder — A09 wires the
 * real plugin output. Nothing here is presented as a live reading of the repo.
 */

/** Closed value domain for DimensionView.status. The UI BRANCHES on this: "n/a"
 *  draws as absent evidence (a dashed track), never a zero-score bar. Mirrors
 *  report_model.STATUS_VOCABULARY. */
export type DimensionStatus = "ok" | "gap" | "n/a";

export interface DimensionProvenance {
  source: string;
  mode: string; // "heuristic" | "authoritative" | "unavailable"
  freshness: string; // short head sha, or "n/a"
  sampled: boolean;
  truncated: boolean;
  disabled_enrichments: string[];
}

export interface DimensionView {
  key: string;
  label: string;
  weight: number;
  /** null ⇒ status "n/a": NO code path may synthesize a number for it (AC2). */
  score: number | null;
  status: DimensionStatus;
  anchor: string;
  detail: string;
  provenance: DimensionProvenance;
  would_light_up: boolean;
}

export interface ReportModel {
  target_display: string;
  grade: string;
  score: number | null;
  gradeable: boolean;
  verdict: string;
  band_label: string;
  mode: string;
  routing_state: string;
  routing_reason: string;
  verified_from: string;
  dimensions: DimensionView[];
  reasons: string[];
  measurable_count: number;
  na_count: number;
  controls_shipwright_would_light: string[];
  honest_ceiling_note: string;
  static_test_inventory: string;
  network_enabled: boolean;
  network_note: string;
  network_enrichments: string[];
  /** Wire-shape version. The UI refuses to render an unrecognised MAJOR. */
  schema_version: string;
}

/** The adopt snapshot the result card renders (mirrors the real snapshot.json
 *  shape at a UI level — stack / tests / ci / conventions + what adopt writes).
 *
 *  This is a FLATTENED display shape, currently fed by `stubData.ts` — nothing
 *  here reads the real `.shipwright/adopt/snapshot.json` yet. Upstream already
 *  treats us as its consumer and has FROZEN the wire shape against `origin/main`
 *  (shipwright `plugins/shipwright-adopt/skills/adopt/references/cross-repo-contract.md`
 *  + `tests/test_snapshot_contract.py`). Two of its rules bind whoever wires the
 *  live read, and neither fails loudly if broken — you get a half-empty card:
 *
 *    - the stack/tests/ci subtrees are DETECTOR-KEYED: iterate them, never index
 *      a fixed key (`stack.frontend.react` breaks on the first Vue repo);
 *    - a field BECOMING NULLABLE is a breaking change even though no key moved —
 *      validate before dereferencing.
 *
 *  `schema_version` is additive: a snapshot written by an older adopt simply
 *  lacks the key and must stay readable. See `reportShape.ts` for how the grade
 *  card already guards its half of the same contract. */
export interface AdoptSnapshot {
  found: Array<{ label: string; value: string }>;
  writes: Array<{ label: string; value: string }>;
}

/** Provenance tag so no stub is ever mistaken for live data (AC3). */
export type Provenance = "stub" | "live";

export type WizardDoor = "new" | "adopt" | "grade";

export interface NewAnswers {
  brief?: string;
  who?: string;
  remember?: string;
  where?: string;
}

export interface WizardState {
  door: WizardDoor | null;
  /** 0 = door picker. new: 1–4 questions, 5 plan. adopt/grade: 1 pick, 2 working, 3 result. */
  step: number;
  answers: NewAnswers;
  /** repo path or GitHub URL for adopt/grade. */
  path: string | null;
  /** working-screen progress index, or null when not working. */
  workingTick: number | null;
}

/** A single row on the flight-plan spine. `answered=false` ⇒ dim node, not a placeholder row. */
export interface FlightRow {
  key: string;
  answered: boolean;
  value: string;
  why: string;
}

/** One readiness check as returned by GET /api/readiness (server mirror). */
export interface ReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  why: string;
  critical: boolean;
}

export interface ReadinessReport {
  ready: boolean;
  checks: ReadinessCheck[];
  repairCommand: string;
}
