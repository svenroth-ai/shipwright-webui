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

/**
 * Iterate K follow-up (ADR-099, 2026-05-14) — `@xterm/addon-serialize`
 * 0.19.0 `_serializeModes()` ONLY emits the `mouseTrackingMode` selector
 * (one of `?9h` / `?1000h` / `?1002h` / `?1003h`) and never the
 * `mouseEncoding` (SGR `?1006h`, URXVT `?1015h`, UTF8 `?1005h`).
 *
 * Verified empirically: Claude Code 2.1.140 emits both `?1000h` (mouse
 * tracking) AND `?1006h` (SGR mouse encoding) at session start. After
 * snapshot serialize → replay roundtrip, `?1006h` is missing. The
 * re-attached terminal has mouse tracking ON but in the LEGACY encoding,
 * which Claude TUI's wheel-event handler does NOT parse. The user-
 * visible symptom: "manchmal kann ich nicht mehr scrollen wenn ich
 * rausgehe und wieder rein" (scroll dead after detach+re-attach to a
 * Claude TUI session that was using mouse-driven scroll).
 *
 * Workaround: if the serialized body contains a mouse-tracking enter,
 * append `?1006h` to the envelope so SGR encoding is also restored.
 * Safe-when-redundant: xterm.js noops the set when the mode is already
 * on, and modern TUIs (Claude included) want SGR encoding when mouse
 * tracking is on.
 *
 * Long-term fix is upstream in xterm.js addon-serialize. This is a
 * pragmatic stop-gap on our serve-time envelope path.
 */
const MOUSE_TRACKING_ENTER_RE = /\x1b\[\?(?:9|1000|1002|1003)h/;
const MOUSE_SGR_ENCODING = "\x1b[?1006h";

export function buildReplaySnapshotEnvelope(
  rec: SnapshotRecord,
): ReplaySnapshotEnvelope {
  let data = rec.data;
  if (MOUSE_TRACKING_ENTER_RE.test(data) && !data.includes(MOUSE_SGR_ENCODING)) {
    data = data + MOUSE_SGR_ENCODING;
  }
  return {
    type: "replay_snapshot",
    data,
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
