/*
 * event-log-reader.ts — tolerant, read-only projection of a managed project's
 * tracked event log (`<projectRoot>/shipwright_events.jsonl`).
 *
 * The event log is the DURABLE, version-controlled record of every completed
 * run: `work_completed` events carry `adr_id` (the task-join key —
 * `task.runId == adr_id`), `commit`, `tests{passed,total}`, `summary`,
 * `spec_impact`, `affected_frs`, `new_frs`, and — when the emitter produced
 * them — `phase_timings`. Phase transitions (`phase_started` /
 * `phase_completed` / `phase_failed`) live as their own lines.
 *
 * This is the net-new reader the WOW campaign's downstream UI (Mission
 * Control's Record + instruments, the Ship's-Log runs/sub-scores/last-proof,
 * the board's per-run facts) is `reader`-tagged against; `campaign-events.ts`
 * is the only prior consumer and DELIBERATELY projects almost none of this
 * (it keeps `commit` only). This reader is a sibling, not a refactor.
 *
 * Contract (A01, campaign webui-wow-usability-2026-07-10):
 *   - Read-only: the WebUI never writes events.jsonl (Architecture rule 1).
 *   - Graceful degradation is HARD: an absent file, an absent field, or a
 *     torn/half-written line yields empty/`null`/`[]` — NEVER a throw or a 500
 *     (mirror campaign-events' per-line try/catch).
 *   - HONEST durations: `phase_timings` is read THROUGH untouched and comes
 *     back `null` when absent (the common case — 296/297 historical rows carry
 *     none). The reader NEVER synthesizes, interpolates, estimates, or
 *     back-fills a duration; A02 owns the duration join semantics.
 *   - Read-through, do-not-collapse: `phase_completed` may repeat per phase
 *     (a phase can have multiple ends) and now carries a top-level split id
 *     (monorepo #369) — every transition line is projected in file order,
 *     never deduped or assumed one-end-per-phase. A02 dedups by (phase, split).
 *   - Amendments (`event_amended`) are NOT overlaid here — that is A02's join
 *     semantics. Base events are projected as-written; this is documented so
 *     the endpoint never claims an amendment-merged view it does not compute.
 */

import { existsSync, readFileSync } from "node:fs";

import { recordsFromLines } from "./jsonl-records.js";
import { pathGuard } from "./path-guard.js";
import {
  EVENT_FILE,
  type EventLogProjection,
  type PhaseTransition,
  type PhaseTransitionType,
  type ProjectEventLogOptions,
  type RunProjection,
  type RunTests,
} from "./event-log-types.js";

export {
  EVENT_FILE,
  type EventLogProjection,
  type PhaseTransition,
  type PhaseTransitionType,
  type ProjectEventLogOptions,
  type RunProjection,
  type RunTests,
} from "./event-log-types.js";

const PHASE_TYPES = new Set<string>([
  "phase_started",
  "phase_completed",
  "phase_failed",
]);

function tsEpoch(ts: unknown): number {
  if (typeof ts !== "string" || !ts) return -Infinity;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : -Infinity;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function asFiniteNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Extract `tests{passed,total}`; null when the event carried no tests object. */
function projectTests(v: unknown): RunTests | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return {
    passed: asFiniteNumberOrNull(o.passed),
    total: asFiniteNumberOrNull(o.total),
  };
}

function projectRun(o: Record<string, unknown>, runId: string): RunProjection {
  return {
    runId,
    eventId: asString(o.id),
    ts: asString(o.ts),
    source: asString(o.source),
    intent: asString(o.intent),
    changeType: asString(o.change_type),
    description: asString(o.description),
    summary: asString(o.summary),
    commit: asString(o.commit),
    specImpact: asString(o.spec_impact),
    affectedFrs: asStringArray(o.affected_frs),
    newFrs: asStringArray(o.new_frs),
    tests: projectTests(o.tests),
    // Read THROUGH untouched: present value as-is, else null (honest n/a).
    phaseTimings: o.phase_timings ?? null,
    campaign: asString(o.campaign),
    subIterateId: asString(o.sub_iterate_id),
  };
}

function projectPhase(o: Record<string, unknown>): PhaseTransition {
  return {
    eventId: asString(o.id),
    type: o.type as PhaseTransitionType,
    phase: asString(o.phase),
    ts: asString(o.ts),
    // Tolerant of camelCase (spec: top-level `splitId`) and snake_case emitters.
    splitId: asString(o.splitId) ?? asString(o.split_id),
    detail: asString(o.detail) ?? asString(o.description),
  };
}

interface RunBest {
  key: number; // ts epoch; -Infinity when unparseable (file index breaks ties)
  idx: number; // strictly-increasing file line index — the last-write tiebreak
  run: RunProjection;
}

/**
 * Pure projection of an event log's lines into per-run rows + phase
 * transitions. Tolerant: blank lines are ignored, a corrupt/torn line is
 * counted in `skippedLines` and skipped (never thrown). `work_completed`
 * events without a truthy `adr_id` cannot form a join key and are not
 * projected as runs (they still count toward `parsedLines`).
 */
export function projectEventLog(
  lines: Iterable<string>,
  opts: ProjectEventLogOptions = {},
): EventLogProjection {
  const bestByRunId = new Map<string, RunBest>();
  const phaseTransitions: PhaseTransition[] = [];
  let idx = 0;
  let totalLines = 0;
  let parsedLines = 0;
  let skippedLines = 0;

  // RECOVERS concatenated records (iterate-2026-07-19-events-reader-recovery):
  // a line holding several records yields ALL of them instead of none. That is
  // reachable without any crash — `shipwright_events.jsonl` carries `merge=union`,
  // and union merge joins an unterminated blob's last line to the other side's
  // first. Dropping the line discarded real `work_completed` events, making a
  // step that happened read as one that never did.
  //
  // `totalLines` / `skippedLines` still count PHYSICAL LINES (the shape the API
  // has always returned); `parsedLines` counts RECOVERED RECORDS, so parsed can
  // now exceed total on a concatenated line — which is precisely the signal that
  // recovery did something.
  for (const o of recordsFromLines(lines, (info) => {
    totalLines++;
    if (info.corrupt) skippedLines++; // torn / corrupt line → skip, never fatal
  })) {
    const i = idx++;
    parsedLines++;
    const type = o.type;

    if (type === "work_completed") {
      const adrId = o.adr_id;
      if (typeof adrId !== "string" || !adrId) continue; // no join key → skip
      const key = tsEpoch(o.ts);
      const prev = bestByRunId.get(adrId);
      // Later (key, idx) wins; idx strictly increases so an equal-key later
      // line supersedes, and an older/lower-key line is discarded.
      if (prev && key < prev.key) continue;
      if (prev && key === prev.key && i <= prev.idx) continue;
      bestByRunId.set(adrId, { key, idx: i, run: projectRun(o, adrId) });
      continue;
    }

    if (typeof type === "string" && PHASE_TYPES.has(type)) {
      phaseTransitions.push(projectPhase(o));
    }
    // Every other event type (event_amended, grade_snapshot, adopted, …) is
    // intentionally not projected here — out of scope for A01, skipped safely.
  }

  let runs = [...bestByRunId.values()]
    .sort((a, b) => (b.key !== a.key ? b.key - a.key : b.idx - a.idx))
    .map((b) => b.run);

  if (opts.runId) {
    runs = runs.filter((r) => r.runId === opts.runId);
  }

  return {
    runs,
    phaseTransitions,
    runCount: runs.length,
    latestRun: runs.length > 0 ? runs[0] : null,
    totalLines,
    parsedLines,
    skippedLines,
  };
}

/** Empty (graceful) projection — an absent/unreadable/guarded-out log. */
function emptyProjection(): EventLogProjection {
  return {
    runs: [],
    phaseTransitions: [],
    runCount: 0,
    latestRun: null,
    totalLines: 0,
    parsedLines: 0,
    skippedLines: 0,
  };
}

/**
 * File-loading wrapper: read `<projectRoot>/shipwright_events.jsonl` and
 * project it. The event filename is a constant (no user-supplied path
 * segment); `pathGuard` is applied defensively so a crafted `projectRoot`
 * can never resolve the read outside itself. A missing / unreadable /
 * guarded-out log yields an empty projection — never an error.
 */
export function readEventLog(
  projectRoot: string,
  opts: ProjectEventLogOptions = {},
): EventLogProjection {
  const guard = pathGuard(projectRoot, EVENT_FILE);
  if (!guard.ok) return emptyProjection();
  if (!existsSync(guard.absolute)) return emptyProjection();
  let text: string;
  try {
    text = readFileSync(guard.absolute, "utf-8");
  } catch {
    return emptyProjection();
  }
  return projectEventLog(text.split("\n"), opts);
}
