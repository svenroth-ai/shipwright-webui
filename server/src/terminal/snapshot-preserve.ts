/*
 * snapshot-preserve.ts — ADR-096 preservation gate, extracted 2026-07-12
 * (iterate-2026-07-12-mirror-flush-preserve-gate).
 *
 * WHY THIS EXISTS
 * ---------------
 * The headless-mirror cell-state is persisted from TWO surfaces in
 * pty-manager.ts:
 *   - finalizeMirrorSnapshot  (kill / pty.onExit path)
 *   - flushMirrorSnapshot     (last-WS-detach keep-alive path, ADR-092)
 *
 * Before this module, ONLY finalize carried the ADR-096 preservation
 * heuristic; flush wrote UNCONDITIONALLY. That asymmetry lost terminal
 * history on the 2nd detach→reopen cycle: a live pty whose Claude TUI had
 * left the alt-screen (DECRST 1049 → near-empty main buffer) serialised to
 * a thin mirror, and the last-detach flush clobbered the richer disk
 * snapshot that a prior detach (or finalize) had written. Next reopen →
 * blank scrollback.
 *
 * The fix lifts the gate into this shared helper so BOTH write surfaces
 * apply it identically.
 *
 * THE HEURISTIC (unchanged from finalize's original inline gate)
 * --------------------------------------------------------------
 * Before writing, compare the about-to-write payload's byte length against
 * any existing on-disk snapshot. If the new one is substantially smaller
 * (< SNAPSHOT_PRESERVE_THRESHOLD of existing), preserve the existing
 * snapshot and skip the write. Rationale: a Claude TUI shutdown / alt-screen
 * exit yields an almost-empty cell-state; the previously-persisted richer
 * state is the correct replay artifact.
 *
 * Edge cases (identical to the original finalize gate):
 *   - No existing snapshot (`read` returns null) → write the new one
 *     (first writer wins; the comparison never fires because existingLen=0).
 *   - `read` throws (malformed header, IO error) → log + write the new one
 *     (best-effort fallback; do not lose data on a stat/parse error).
 *   - New payload empty + existing has content → preserve existing
 *     (subsumed by the threshold rule; 0 < existing * threshold).
 *
 * KNOWN, ACCEPTED LIMITATION (pre-existing, shared with the old finalize
 * gate): read-then-write is NOT atomic. A concurrent writer between the
 * read and the write could interleave. This is the SAME non-atomicity the
 * inline finalize gate already had; per-task write serialisation lives one
 * layer down in SnapshotStore's PQueue. Adding cross-read+write locking is
 * explicitly OUT of scope for the extraction (see ADR).
 *
 * RESURRECTION GUARD (iterate-2026-07-12, doubt-review HIGH): the
 * `await store.read` below YIELDS the event loop. SnapshotStore.write()
 * enqueues SYNCHRONOUSLY (validateTaskId -> getOrCreateWriteQueue ->
 * queue.add all run before its first await), so pre-extraction the caller's
 * `if (entry.tornDown) return;` guard sat DIRECTLY before the synchronous
 * write with no yield between them — a concurrent delete cascade's clear()
 * fence always serialised AFTER the write. Introducing the unqueued
 * `store.read` reopened that gap: a delete (kill sets tornDown + releaseQueue,
 * then clear() unlinks the `.snapshot`) can land while we park at read, and
 * the post-read write would RE-CREATE the just-wiped, secret-bearing file
 * (privacy resurrection). The optional `shouldProceed` predicate restores the
 * pre-extraction guarantee: it is re-checked SYNCHRONOUSLY immediately before
 * the write enqueue (no await between), so a caller passing
 * `() => !entry.tornDown` aborts the write exactly when the old guard would
 * have. The kill/finalize path OMITS the predicate (its write MUST land — it
 * is the authoritative exit snapshot, fenced by kill-awaits-finalize-before-
 * clear).
 */

/** ADR-096 threshold. A new payload below this fraction of an existing
 *  on-disk payload is treated as a TUI alt-screen-exit clear and the write
 *  is skipped to preserve the richer snapshot. Heuristic — do NOT tune
 *  without re-verifying the DECRST-1049 scenario. */
export const SNAPSHOT_PRESERVE_THRESHOLD = 0.6;

/** Minimal read+write surface the gate needs — structurally satisfied by
 *  SnapshotStore, and by a fake in unit tests. */
export interface SnapshotReadWrite {
  read(taskId: string): Promise<{ data: string } | null>;
  write(
    taskId: string,
    payload: { cols: number; rows: number; data: string },
  ): Promise<void>;
}

export interface WriteSnapshotPreservingLargerOpts {
  /** Structured logger for the skip / read-failure notices. Defaults to
   *  console.warn so production observability picks up misclassifications
   *  without a code change (matches the original inline gate). */
  log?: (msg: string) => void;
  /** Caller label embedded in the warn lines (e.g. "finalizeMirrorSnapshot"
   *  / "flushMirrorSnapshot") so a skip is attributable in the logs. */
  caller?: string;
  /** SYNCHRONOUS liveness predicate re-checked immediately before the write
   *  enqueue (no await between the check and store.write). Returns false to
   *  ABORT the write — closes the resurrection race where the unqueued
   *  `await store.read` yields the loop and a concurrent delete cascade
   *  (kill sets tornDown + clear() unlinks the snapshot) lands in the gap;
   *  without this, the post-read write would re-create the just-wiped file.
   *  The flush path passes `() => !entry.tornDown`; the kill/finalize path
   *  OMITS it (its write must land). See the RESURRECTION GUARD note above. */
  shouldProceed?: () => boolean;
}

export interface WriteSnapshotResult {
  /** True when the write did NOT happen — either a preserve-skip (richer
   *  existing snapshot) or a liveness abort (see `aborted`). */
  skipped: boolean;
  /** True when the write was ABORTED by `shouldProceed()` returning false
   *  (liveness lost between read and write — a concurrent delete/teardown).
   *  Distinct from a preserve-skip: `aborted` means "do NOT resurrect", not
   *  "keep the richer existing one". Absent/false on the preserve-skip and
   *  write branches. */
  aborted?: boolean;
}

/**
 * Write `payload` for `taskId` via `store`, UNLESS an existing on-disk
 * snapshot is substantially larger — in which case preserve the existing
 * one and skip the write (ADR-096).
 *
 * Best-effort on read: a read failure logs and falls through to write, so a
 * malformed/unreadable existing snapshot never blocks persistence.
 *
 * Never throws for the gate logic itself; a `write` rejection propagates to
 * the caller (both call sites already wrap this in try/catch).
 */
export async function writeSnapshotPreservingLarger(
  store: SnapshotReadWrite,
  taskId: string,
  payload: { cols: number; rows: number; data: string },
  opts: WriteSnapshotPreservingLargerOpts = {},
): Promise<WriteSnapshotResult> {
  const warn =
    opts.log ??
    ((msg: string) => {
      // eslint-disable-next-line no-console
      console.warn(msg);
    });
  const caller = opts.caller ?? "writeSnapshotPreservingLarger";

  let existingDataLen = 0;
  try {
    const existing = await store.read(taskId);
    if (existing) existingDataLen = existing.data.length;
  } catch (readErr) {
    warn(
      `[snapshot-preserve] ${caller}: existing snapshot read failed for ${taskId} (${(readErr as Error).message}) — proceeding with write`,
    );
    // existingDataLen stays 0 → the comparison below cannot fire, the new
    // snapshot is written (best-effort: never lose data on a read error).
  }

  const newDataLen = payload.data.length;
  if (existingDataLen > 0 && newDataLen < existingDataLen * SNAPSHOT_PRESERVE_THRESHOLD) {
    warn(
      `[snapshot-preserve] ${caller}: preserving richer on-disk snapshot for ${taskId} (new=${newDataLen}B, existing=${existingDataLen}B — likely Claude TUI exit clear, ADR-096)`,
    );
    return { skipped: true };
  }

  // Resurrection guard — re-check liveness SYNCHRONOUSLY here, immediately
  // before the write enqueue. `store.write` enqueues synchronously, so there
  // is NO await between this check and the enqueue: a delete cascade that
  // completed while we parked at `store.read` above cannot be re-raced by
  // this write. Abort rather than re-create a just-wiped snapshot.
  if (opts.shouldProceed && !opts.shouldProceed()) {
    warn(
      `[snapshot-preserve] ${caller}: aborting write for ${taskId} — liveness lost after read (concurrent delete/teardown); not resurrecting the snapshot`,
    );
    return { skipped: true, aborted: true };
  }

  await store.write(taskId, payload);
  return { skipped: false };
}
