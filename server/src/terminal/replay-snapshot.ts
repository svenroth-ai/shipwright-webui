/*
 * replay-snapshot.ts — Iterate B (ADR-089).
 *
 * Helpers for the WS replay-snapshot path (cell-state snapshot envelope
 * supersedes the chunked scrollback replay). Extracted out of routes.ts
 * so the version-gate decision is unit-testable without standing up a
 * full WS stack.
 *
 * Two public entry points:
 *   - `tryReadSnapshot(store, taskId, expectedVersion)` — read + parse +
 *     version-gate the on-disk snapshot. Returns the record when usable,
 *     null when missing / read-error / version-mismatch (caller falls
 *     back to chunked replay).
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
 * Best-effort: a read error returns null + console.warn so the caller
 * falls through to the chunked replay path. Plan invariant #5: version
 * mismatch is fallback, NOT crash.
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
      `[terminal] snapshot version mismatch for ${taskId}: file=${rec.terminalVersion} expected=${expectedVersion} — falling back to chunked replay`,
    );
    return null;
  }
  return rec;
}
