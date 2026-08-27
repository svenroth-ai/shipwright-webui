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

/*
 * PARSER-RESYNC PREAMBLE (iterate-2026-07-30-terminal-ws-drop-resync, FR-01.28).
 *
 * `xterm.Terminal.reset()` does NOT reset the escape-sequence PARSER. The client
 * restores a snapshot with `term.reset()` then `term.write(data)`, so whenever the
 * previously-received byte stream ended mid-sequence, the parser is parked
 * off-ground and the payload's FIRST bytes are swallowed as continuation of that
 * truncated sequence — the whole restored grid then lands one row off (measured:
 * 51 of 52 rows wrong against a real 110x52 recording, while a FRESH terminal fed
 * the same payload is byte-exact).
 *
 * A truncated stream is not a corner case here: `deliverWithBackpressure` drops a
 * chunk mid-sequence by definition, and the real recording's reproducing cut ends
 * with `ESC [ 3 8 ; 2` — a half-written truecolor CSI. Every parser class is
 * reachable (mid-CSI / mid-OSC / mid-DCS / lone ESC / mid-charset).
 *
 * CAN (0x18) is ISO 6429 "abort sequence in progress" and was verified to recover
 * ALL SIX truncation classes on its own, so the abort is what does the work; the
 * CUP-home that follows is the payload's own precondition made explicit rather
 * than inherited from `reset()`'s side effects.
 *
 * Served here — one seam covering attach replay, reconnect replay AND resync —
 * and safe-when-redundant: CAN on a ground-state parser is a no-op and the cursor
 * is already home after `reset()`. Guard: `snapshot-parser-resync.test.ts`.
 * Deliberately NOT another repaint/refresh heal — nine of those shipped in this
 * class before it; this repairs the BUFFER, not the pixels.
 */
const CAN = String.fromCharCode(24);
const PARSER_RESYNC_PREAMBLE = `${CAN}\x1b[H`;

/*
 * Interaction-mode teardown (iterate-2026-08-27-terminal-replay-reset-
 * reopen-reconnect, FR-01.28). A `done`/`launch_failed` replay is
 * ONE-SHOT and final — no live pty will ever follow up with a mode
 * reset. If the serialized snapshot left mouse tracking (and/or the
 * VT200 "alternate scroll" translation, `?1007h`) turned ON — which
 * Claude's TUI does for the whole lifetime of a session — those modes
 * stay latched in the reader's xterm instance forever:
 *   - Mouse tracking ON makes xterm disable native DOM text selection
 *     (`_selectionService.disable()`), so click+drag copy silently
 *     selects nothing.
 *   - Alternate-scroll-mode ON makes a wheel event become synthetic
 *     arrow-key bytes routed through `onData` -> `socket.send`, which
 *     is a no-op once the WS has closed (replay-only has no live pty
 *     to receive them) — the wheel LOOKS like it does nothing.
 * Reported by Sven as "Session ended… aber nichts geht mehr" (neither
 * scroll nor copy) — this is why. Deliberately does NOT touch the
 * alt-screen-buffer mode (`?1049`): exiting it would swap the replayed
 * grid out for whatever the MAIN buffer held before Claude's TUI
 * entered the alt screen, which is exactly the content the user is
 * trying to read/copy — that would trade one defect for a worse one.
 * Safe-when-redundant: disabling an already-off mode is a no-op.
 *
 * The `?1006l` here runs right after the ADR-099 fixup above may have just
 * appended `?1006h` for THIS SAME snapshot — deliberate, not a bug: the
 * fixup keeps the live-attach/resync callers (which never set this option)
 * correct, while the replay-only caller wants the opposite final state.
 * Leaving the fixup unconditional and overriding it here (rather than
 * skipping it for replay-only) keeps that shared code path single, byte-
 * identical for both callers up to this point.
 */
const INTERACTION_MODE_TEARDOWN =
  "\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?9l\x1b[?1006l\x1b[?1007l";

export interface BuildReplaySnapshotEnvelopeOptions {
  /**
   * Set for a `done`/`launch_failed` (replay-only) attach — see
   * `INTERACTION_MODE_TEARDOWN` above. Never set for a live attach or
   * a live resync: those keep the ADR-099 `?1006h` restoration intact
   * because a live pty is still there to react to further mouse input.
   */
  tearDownInteractionModes?: boolean;
}

export function buildReplaySnapshotEnvelope(
  rec: SnapshotRecord,
  opts?: BuildReplaySnapshotEnvelopeOptions,
): ReplaySnapshotEnvelope {
  let data = rec.data;
  if (MOUSE_TRACKING_ENTER_RE.test(data) && !data.includes(MOUSE_SGR_ENCODING)) {
    data = data + MOUSE_SGR_ENCODING;
  }
  if (!data.startsWith(PARSER_RESYNC_PREAMBLE)) {
    data = PARSER_RESYNC_PREAMBLE + data;
  }
  if (opts?.tearDownInteractionModes) {
    data = data + INTERACTION_MODE_TEARDOWN;
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
