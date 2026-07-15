/*
 * event-log-types.ts — shape contract for the tracked event-log reader
 * (`event-log-reader.ts`). Split out to keep the reader body under the 300-LOC
 * ceiling (CLAUDE.md file-size rule); these are the JSON shapes the WOW
 * campaign's `reader`-tagged UI (Mission Control Record + instruments,
 * Ship's-Log runs/sub-scores/last-proof, board per-run facts) consumes.
 *
 * Read-only projection: every field is optional at the source — absent →
 * `null` / `[]`. Durations are read THROUGH untouched and come back `null`
 * when the emitter produced none; the reader never synthesizes one.
 */

/** Per-tree, version-controlled event log (parity with events_log.EVENT_FILE). */
export const EVENT_FILE = "shipwright_events.jsonl";

/** Test counts from a `work_completed` event; either mark may be absent. */
export interface RunTests {
  passed: number | null;
  total: number | null;
}

/**
 * One completed run, keyed by `runId` (== the event's `adr_id`, the join key
 * to a task). Every field is optional at the source: absent → `null` / `[]`.
 */
export interface RunProjection {
  /** The event `adr_id` — the task-join key (`task.runId == adr_id`). */
  runId: string;
  /** The originating event id (`evt-...`), or null when absent. */
  eventId: string | null;
  /** ISO timestamp of the winning `work_completed`, or null when absent. */
  ts: string | null;
  /** Emitter source, e.g. "iterate" | "pipeline". */
  source: string | null;
  /** The `intent` field (feature/change/infra/...), read through raw. */
  intent: string | null;
  /** The `change_type` field, read through raw (distinct from `intent`). */
  changeType: string | null;
  description: string | null;
  summary: string | null;
  /**
   * The commit sha of the run. Kept as the raw string, so an empty `""` (a
   * worktree F5b event emits `commit: ""`) is preserved as present-but-empty;
   * `null` only when the field was entirely absent. Consumers slice(0,7).
   */
  commit: string | null;
  /** Raw `spec_impact` — case preserved (none/modify/MODIFY/…); A02 normalizes. */
  specImpact: string | null;
  /** `affected_frs`, string members only; `[]` when absent. */
  affectedFrs: string[];
  /** `new_frs`, string members only; `[]` when absent. */
  newFrs: string[];
  /** `tests{passed,total}` or null when the event carried none. */
  tests: RunTests | null;
  /**
   * `phase_timings` read THROUGH untouched (an iterate flat mark-list when
   * present), or `null` when absent — the honest "render n/a" signal. NEVER
   * synthesized. Typed `unknown` because the reader ascribes no semantics.
   */
  phaseTimings: unknown;
  /** Campaign slug when this run was a campaign sub-iterate, else null. */
  campaign: string | null;
  /** Sub-iterate id when this run was a campaign sub-iterate, else null. */
  subIterateId: string | null;
}

export type PhaseTransitionType =
  | "phase_started"
  | "phase_completed"
  | "phase_failed";

/**
 * A phase transition line, projected in file order and NEVER collapsed. The
 * top-level split id (monorepo #369) is read through untouched; a phase may
 * legitimately have multiple `phase_completed` ends. A02 dedups by (phase,
 * splitId) — this reader must not.
 */
export interface PhaseTransition {
  eventId: string | null;
  type: PhaseTransitionType;
  phase: string | null;
  ts: string | null;
  /** Top-level split id (`splitId`/`split_id`), read through; null when absent. */
  splitId: string | null;
  /** Free-text `detail`/`description`, when present. */
  detail: string | null;
}

export interface EventLogProjection {
  /** Runs deduped by `runId`/`adr_id` (latest `work_completed` wins), ts-desc. */
  runs: RunProjection[];
  /** All phase transitions, file order, uncollapsed. */
  phaseTransitions: PhaseTransition[];
  /** `runs.length` (of the returned, possibly runId-filtered set). */
  runCount: number;
  /** The most-recent run (runs[0]) or null — the Ship's-Log "last proof". */
  latestRun: RunProjection | null;
  /** Non-empty lines seen (`parsedLines + skippedLines`). */
  totalLines: number;
  /** Lines that parsed as a JSON object. */
  parsedLines: number;
  /** Non-empty lines that FAILED to parse (torn/corrupt) — skipped, not fatal. */
  skippedLines: number;
}

export interface ProjectEventLogOptions {
  /** When set, `runs` is filtered to this single `adr_id` (taskDetail view). */
  runId?: string;
}
