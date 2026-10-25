/*
 * adoptSnapshotProfile.ts — tolerant reader for the `profile` block of the
 * adopt snapshot (`.shipwright/adopt/snapshot.json`). Upstream bumped the
 * snapshot to schema_version "1.1" (ADDITIVE): `profile.source`,
 * `profile.warnings` and `candidates[].source` were added. Cross-repo rules
 * (`cross-repo-contract.md`): a 1.0 snapshot simply lacks the new keys and must
 * stay readable; never assume a key exists; an unknown MAJOR is refused.
 * Nothing renders a live snapshot yet (AdoptResult is still fed by stubData);
 * this is the guarded entry point that wiring must use.
 */

export type SnapshotProfileSource = "project" | "user" | "bundled" | "user-hint" | (string & {});

export interface SnapshotProfile {
  matched: string | null;
  confidence: number | null;
  /** Absent in a 1.0 snapshot. */
  source: SnapshotProfileSource | null;
  /** Absent in a 1.0 snapshot; e.g. an invalid custom profile found in discovery. */
  warnings: string[];
}

export const SUPPORTED_SNAPSHOT_MAJOR = 1;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export type SnapshotProfileResult =
  | { ok: true; profile: SnapshotProfile }
  | { ok: false; reason: string };

export function readSnapshotProfile(raw: unknown): SnapshotProfileResult {
  if (!isObject(raw)) return { ok: false, reason: "snapshot is not an object" };
  if (raw.schema_version !== undefined) {
    const major = Number.parseInt(String(raw.schema_version).split(".")[0] ?? "", 10);
    if (!Number.isFinite(major) || major < 1 || major > SUPPORTED_SNAPSHOT_MAJOR) {
      return { ok: false, reason: `schema_version ${String(raw.schema_version)} is not a version this build reads` };
    }
  }
  const p = raw.profile;
  if (!isObject(p)) return { ok: false, reason: "snapshot has no profile block" };
  return {
    ok: true,
    profile: {
      matched: typeof p.matched === "string" ? p.matched : null,
      confidence: typeof p.confidence === "number" ? p.confidence : null,
      source: typeof p.source === "string" ? p.source : null,
      warnings: Array.isArray(p.warnings) ? p.warnings.filter((w): w is string => typeof w === "string") : [],
    },
  };
}
