/*
 * replay-snapshot.ts — Iterate B (ADR-089), updated Iterate C (ADR-087).
 *
 * Helpers for the WS replay-snapshot path (cell-state snapshot envelope
 * superseded — and as of Iterate C, fully replaced — the chunked
 * scrollback replay). Extracted out of routes.ts so the version-gate
 * decision is unit-testable without standing up a full WS stack.
 *
 * Two public entry points:
 *   - `tryReadSnapshot(store, taskId, expectedVersion)` — read + parse +
 *     version-gate the on-disk snapshot. Returns the record when usable,
 *     null when missing / read-error / version-mismatched → caller
 *     emits no replay envelope (blank terminal with live shell).
 *   - `buildReplaySnapshotEnvelope(rec)` — produce the wire JSON.
 *
 * Decision: version-gate is configurable via `expectedVersion`. When
 * unset, accept any version (test fixtures + legacy compat). Production
 * wires the runtime-pinned `@xterm/headless` version.
 */

import type { SnapshotRecord, SnapshotStore } from "./snapshot-store.js";

export interface ReplaySnapshotEnvelope {
  type: "replay_snapshot";
  data: string;
  cols: number;
  rows: number;
  terminalVersion: string;
}

export function buildReplaySnapshotEnvelope(
  rec: SnapshotRecord,
): ReplaySnapshotEnvelope {
  return {
    type: "replay_snapshot",
    data: rec.data,
    cols: rec.cols,
    rows: rec.rows,
    terminalVersion: rec.terminalVersion,
  };
}

/**
 * Read + version-gate the snapshot for a task.
 *
 * Returns:
 *   - SnapshotRecord when present AND parseable AND (version-unset OR
 *     version matches `expectedVersion`).
 *   - null when absent (ENOENT — pre-Iterate-B task; no snapshot),
 *     unreadable (logged), or version-mismatched (logged).
 *
 * Best-effort: a read error returns null + console.warn → no replay
 * history is sent (blank terminal with live shell; Iterate C / ADR-087
 * retired the chunked-replay fallback). Plan invariant #5: version
 * mismatch is no-replay, NOT crash.
 */
export async function tryReadSnapshot(
  store: SnapshotStore | undefined,
  taskId: string,
  expectedVersion: string | undefined,
  logWarn: (msg: string) => void = (m) => console.warn(m),
): Promise<SnapshotRecord | null> {
  if (!store) return null;
  let rec: SnapshotRecord | null;
  try {
    rec = await store.read(taskId);
  } catch (err) {
    logWarn(
      `[terminal] snapshot read failed for ${taskId}: ${(err as Error).message}`,
    );
    return null;
  }
  if (!rec) return null;
  if (expectedVersion && rec.terminalVersion !== expectedVersion) {
    logWarn(
      `[terminal] snapshot version mismatch for ${taskId}: file=${rec.terminalVersion} expected=${expectedVersion} — no replay history will be sent`,
    );
    return null;
  }
  return rec;
}
