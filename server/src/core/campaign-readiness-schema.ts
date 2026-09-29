/*
 * campaign-readiness-schema.ts — the WebUI's verbatim mirror of the monorepo's
 * `loop_claim.py readiness` output (contract `loop-readiness-1.0`, produced by
 * `shared/scripts/lib/loop_ready_set.py build_readiness`, pinned monorepo-side by
 * `shared/tests/contracts/loop-readiness-1.0.json`).
 *
 * The WebUI NEVER derives readiness: whether a unit is launchable depends on
 * git ancestry against the batch base and on the branch strategy, neither of
 * which a display layer can see. It renders what the scheduler reported.
 * Hence this module is types + a shape guard, and nothing that computes a
 * verdict. Drift guard: `campaign-readiness-schema.test.ts` validates the
 * vendored contract fixture and, when the sibling monorepo clone exists, that
 * the fixture still equals the monorepo's file (CLAUDE.md DO-NOT #7).
 *
 * Version handling follows the grade/adopt convention: a different MAJOR is
 * "unsupported" (never guessed at); an additive MINOR parses as today.
 */

/** Closed `blocked_by[].reason` vocabulary of contract 1.0. */
export const READINESS_REASONS = [
  "campaign_finalized",
  "commit_missing",
  "commit_not_on_base",
  "dependency_missing",
  "not_merged",
  "unsupported_strategy",
] as const;
export type ReadinessReason = (typeof READINESS_REASONS)[number];

export const SUPPORTED_READINESS_MAJOR = 1;

export interface UnitBlocker {
  /** The blocking dependency; null for a campaign-level gate (finalized / strategy). */
  id: string | null;
  /** A ReadinessReason in 1.0; kept a string so an additive minor still renders. */
  reason: string;
  detail: string;
}

export interface UnitReadiness {
  id: string;
  /** Loop-state unit status (pending, claimed, running, built, reviewed, merging, merged, failed, held, …). */
  state: string;
  ready: boolean;
  blocked_by: UnitBlocker[];
}

export interface ReadinessReport {
  schema_version: string;
  loop_id: string | null;
  branch_strategy: string;
  base_branch: string | null;
  supported: boolean;
  finalized: boolean;
  ready_ids: string[];
  units: UnitReadiness[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function isBlocker(v: unknown): v is UnitBlocker {
  return (
    isRecord(v) &&
    (v.id === null || typeof v.id === "string") &&
    typeof v.reason === "string" &&
    typeof v.detail === "string"
  );
}

function isUnit(v: unknown): v is UnitReadiness {
  return (
    isRecord(v) &&
    typeof v.id === "string" &&
    typeof v.state === "string" &&
    typeof v.ready === "boolean" &&
    Array.isArray(v.blocked_by) &&
    v.blocked_by.every(isBlocker)
  );
}

/** Major component of a `"<major>.<minor>"` version, or null when unparseable. */
export function readinessMajor(version: unknown): number | null {
  if (typeof version !== "string") return null;
  const m = /^(\d+)\.\d+/.exec(version);
  return m ? Number(m[1]) : null;
}

/** Shape guard: the parsed report, or null when the payload is not contract-shaped. */
export function parseReadinessReport(raw: unknown): ReadinessReport | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.schema_version !== "string") return null;
  if (!(raw.loop_id === null || typeof raw.loop_id === "string")) return null;
  if (typeof raw.branch_strategy !== "string") return null;
  if (!(raw.base_branch === null || typeof raw.base_branch === "string")) return null;
  if (typeof raw.supported !== "boolean" || typeof raw.finalized !== "boolean") return null;
  if (!Array.isArray(raw.ready_ids) || !raw.ready_ids.every((x) => typeof x === "string")) return null;
  if (!Array.isArray(raw.units) || !raw.units.every(isUnit)) return null;
  return raw as unknown as ReadinessReport;
}
