import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getTranscript,
  type ExternalTask,
  type TranscriptChunk,
} from "../lib/externalApi";

export type TranscriptStatus =
  | "idle"
  | "polling"
  | "ok"
  | "missing"
  | "rotated"
  | "error";

export interface UseTaskTranscriptResult {
  status: TranscriptStatus;
  /** The full JSONL, ACCUMULATED across polls rather than re-fetched whole
   *  each tick (iterate-2026-07-22-…-cursor-single-walk). Consumers still get
   *  everything — `BubbleTranscript` and `parseSessionJsonl` render all of it —
   *  but the wire carries only the delta. Always ends on a `\n` because the
   *  server cuts chunks on line boundaries, so it is a whole-line prefix of the
   *  file at every instant. */
  content: string;
  size: number;
  fingerprint: string | null;
  task: ExternalTask | null;
  /** Best-effort model name from the most recent `"model":"..."` in the
   *  transcript. Derived here (once per poll) so the single poller is the
   *  SOLE source — TaskDetailHeader reads it as a prop instead of mounting
   *  its own duplicate poller (campaign D15 / F22). */
  modelName: string | null;
  errorMessage: string | null;
}

/** The accumulated transcript and the byte cursor that owns it. */
export interface TranscriptBuffer {
  content: string;
  /** Next `fromByte` to request — the last accepted chunk's `toByte`. BYTES,
   *  never `content.length`: the string is UTF-16 code units and the offsets
   *  are bytes, so they diverge on the first non-ASCII character. */
  cursor: number;
  modelName: string | null;
}

/**
 * Fold one chunk into the accumulated buffer. Pure, and exported so the cursor
 * protocol can be tested without a poller around it.
 *
 * The decision is made from what the server ECHOED BACK, never from what the
 * client believed it asked for, and it is committed against the cursor that is
 * CURRENTLY accepted — so a duplicate or out-of-order response is a no-op
 * rather than a splice at the wrong offset (external plan review, openai #1).
 */
export function accumulate(
  prev: TranscriptBuffer,
  chunk: TranscriptChunk,
): { next: TranscriptBuffer; accepted: boolean } {
  if (chunk.fromByte === 0) {
    // A whole-file snapshot is authoritative: the model must be allowed to
    // become null again, or a rotation/task-switch leaks the old one
    // (external plan review, openai #2).
    return {
      next: {
        content: chunk.content,
        cursor: chunk.toByte,
        modelName: extractModelName(chunk.content),
      },
      accepted: true,
    };
  }
  if (chunk.fromByte === prev.cursor) {
    return {
      next: {
        content: prev.content + chunk.content,
        cursor: chunk.toByte,
        // Last occurrence overall = last occurrence in the newest delta that
        // has one, so carrying `prev` forward is exact, and O(delta).
        modelName: extractModelName(chunk.content) ?? prev.modelName,
      },
      accepted: true,
    };
  }
  // Neither a snapshot nor the delta we are waiting for — REACHABLE, not
  // defensive padding: a truncation between the reader's `findByUuid` and its
  // `readTailFromDisk` clamps `from` down to the live size, so a cursor past
  // that end comes back as `{fromByte: liveSize, toByte: liveSize}` (internal
  // review verified this by probe). Keep what is on screen and rewind, so the
  // next poll refetches whole instead of splicing at the wrong offset.
  return { next: { ...prev, cursor: 0 }, accepted: false };
}

const EMPTY_BUFFER: TranscriptBuffer = { content: "", cursor: 0, modelName: null };

/**
 * Ask for the whole file once every N polls regardless of the cursor.
 *
 * The server reports `rotated` only when the transcript SHRANK
 * (`session-watcher.ts` — `sizeBytes < fromByte || sizeBytes < prevSize`), so a
 * transcript REPLACED under the same uuid by a same-or-larger one slips through
 * and its delta gets appended onto the wrong prefix. The pane then disagrees
 * with disk permanently. Before this run the 1 Hz whole-file poll repaired that
 * within a second BY ACCIDENT; the resync buys the self-healing back on purpose
 * — and it covers any other cause of divergence, including a bug in the fold.
 *
 * 60 keeps ~98 % of the saving (one whole-file read a minute instead of sixty)
 * while bounding how long the pane can be wrong.
 */
export const RESYNC_EVERY_POLLS = 60;

/**
 * Sequential polling at 1s cadence. Never stacks requests: the next tick
 * is scheduled only after the previous fetch settles. Stops on unmount or
 * when the task hits a terminal state (`done`, `launch_failed`).
 *
 * Sends an incremental `fromByte` and accumulates. Before
 * iterate-2026-07-22-…-cursor-single-walk it sent 0 every tick, so the server
 * re-read, re-decoded and re-serialised the entire transcript once a second:
 * 9.19 ms / 2 725 KB per poll at this project's median, 384.68 ms / 136 MB at
 * its largest. The endpoint has accepted a cursor since day one (CLAUDE.md
 * rule 4 — stateless reads are what make that safe); nothing was missing but a
 * client that used it.
 */
export function useTaskTranscript(taskId: string | null, options: { intervalMs?: number } = {}) {
  const intervalMs = options.intervalMs ?? 1000;
  const qc = useQueryClient();
  const [result, setResult] = useState<UseTaskTranscriptResult>({
    status: "idle",
    content: "",
    size: 0,
    fingerprint: null,
    task: null,
    modelName: null,
    errorMessage: null,
  });
  const fingerprintRef = useRef<string | null>(null);
  // The accumulated transcript and its cursor, together in ONE ref so the
  // check-and-advance is a single synchronous critical section with no `await`
  // inside it. That — not the sequential timer — is what makes a duplicate or
  // late response impossible to apply twice.
  const bufRef = useRef<TranscriptBuffer>(EMPTY_BUFFER);
  /** Polls since the last whole-file baseline — see `RESYNC_EVERY_POLLS`. */
  const pollsSinceResyncRef = useRef(0);
  // F21 fix — the terminal-state stop condition below used to read
  // `result.task` from this effect's MOUNT-time closure (always the
  // initial `null`), so it never fired: a `done` / `launch_failed` task
  // polled forever. Track the freshest server-reported state in a ref the
  // tick can read on each iteration.
  const latestStateRef = useRef<string | null>(null);

  useEffect(() => {
    // Reset the terminal-state tracker for THIS effect run: the ref
    // outlives the effect, so a prior `done` task's state must not leak
    // into a newly-selected running task (which would stop its first
    // tick prematurely — external code review, D15). Each taskId change
    // starts from a clean "unknown" slate.
    latestStateRef.current = null;
    // A new task means a new file: the cursor and the accumulated text are
    // meaningless against it, and so is the fingerprint. Carrying the
    // fingerprint across a switch was a pre-existing defect — the server
    // compares the supplied `mtime:size` against the NEW file and reported a
    // spurious `rotated` on the first poll whenever the incoming transcript
    // was the smaller of the two.
    bufRef.current = EMPTY_BUFFER;
    fingerprintRef.current = null;
    pollsSinceResyncRef.current = 0;
    // Publish the reset, don't just perform it on the refs. Until the new
    // task's first response lands the pane would otherwise keep rendering the
    // PREVIOUS task's conversation and model name — a window that widens to
    // "indefinitely" if that first request is slow or fails. Pre-existing, but
    // AC-2 claims a reset here, and a claim the state does not honour is worse
    // than no claim (external diff review, openai).
    setResult({
      status: taskId ? "polling" : "idle",
      content: "",
      size: 0,
      fingerprint: null,
      task: null,
      modelName: null,
      errorMessage: null,
    });
    if (!taskId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      try {
        const dueForResync = pollsSinceResyncRef.current >= RESYNC_EVERY_POLLS;
        const response = await getTranscript(taskId, {
          fromByte: dueForResync ? 0 : bufRef.current.cursor,
          expectFingerprint: fingerprintRef.current,
        });
        if (cancelled) return;
        // `missing` / `rotated` both empty the buffer, so the next poll is a
        // baseline anyway — only a delivered delta ages the clock.
        pollsSinceResyncRef.current =
          dueForResync || response.status !== "ok" ? 0 : pollsSinceResyncRef.current + 1;
        if (response.status === "missing") {
          bufRef.current = EMPTY_BUFFER;
          fingerprintRef.current = null;
          setResult({
            status: "missing",
            content: "",
            size: 0,
            fingerprint: null,
            task: response.task,
            modelName: null,
            errorMessage: null,
          });
        } else if (response.status === "rotated") {
          // The file changed identity. An offset into the old one addresses
          // nothing in the new one, so the cursor and the accumulated text go
          // with the fingerprint.
          bufRef.current = EMPTY_BUFFER;
          fingerprintRef.current = null;
          setResult((prev) => ({ ...prev, status: "rotated", task: response.task }));
        } else {
          const { next, accepted } = accumulate(bufRef.current, response.chunk);
          bufRef.current = next;
          // A rejected chunk drops the fingerprint too, so the resync poll goes
          // out as a plain whole-file read with no rotation check to misfire.
          fingerprintRef.current = accepted ? response.chunk.fingerprint : null;
          setResult({
            status: "ok",
            content: next.content,
            size: response.chunk.size,
            fingerprint: fingerprintRef.current,
            task: response.task,
            modelName: next.modelName,
            errorMessage: null,
          });
        }
        // Server-side state-machine transitions ride on the transcript
        // response. Push the freshest task into TanStack's cache so
        // SessionMetadata, EditableTaskTitle, and TerminalLaunchButton
        // (all readers of useExternalTask) reflect new states without
        // needing their own refetch interval.
        if (response.task) {
          latestStateRef.current = response.task.state;
          qc.setQueryData(["external-task", response.task.taskId], response.task);
        }
      } catch (err) {
        if (cancelled) return;
        setResult((prev) => ({
          ...prev,
          status: "error",
          errorMessage: err instanceof Error ? err.message : String(err),
        }));
      }
      if (cancelled) return;
      const currentState = latestStateRef.current ?? "";
      if (currentState === "done" || currentState === "launch_failed") {
        return;
      }
      timer = setTimeout(tick, intervalMs);
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, intervalMs]);

  return result;
}

/** Helper: decide whether a given transcript chunk indicates new content vs
 *  a stable mid-polling snapshot. Useful in tests and for avoiding spurious
 *  re-renders downstream. */
export function isFreshChunk(prev: string, next: TranscriptChunk): boolean {
  return next.content !== prev;
}

/** Best-effort model name = the LAST `"model":"..."` occurrence in the raw
 *  JSONL. Returns null when none is present. Pure so it can be unit-tested
 *  and reused; previously duplicated inside TaskDetailHeader's own poller
 *  (campaign D15 / F22). */
export function extractModelName(content: string): string | null {
  if (!content) return null;
  const re = /"model"\s*:\s*"([^"]+)"/g;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    last = m[1];
  }
  return last;
}
