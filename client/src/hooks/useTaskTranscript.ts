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
  /** Full JSONL content from fromByte=0 (we re-request the whole file for
   *  the v1 vertical slice; incremental byte-offset fastpath is Sub-iterate
   *  1.5 work if this becomes a hot-path bottleneck). */
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

/**
 * Sequential polling at 1s cadence. Never stacks requests: the next tick
 * is scheduled only after the previous fetch settles. Stops on unmount or
 * when the task hits a terminal state (`done`, `launch_failed`).
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
    if (!taskId) {
      setResult((r) => ({ ...r, status: "idle" }));
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      try {
        const response = await getTranscript(taskId, {
          fromByte: 0,
          expectFingerprint: fingerprintRef.current,
        });
        if (cancelled) return;
        if (response.status === "missing") {
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
          fingerprintRef.current = null;
          setResult((prev) => ({ ...prev, status: "rotated", task: response.task }));
        } else {
          fingerprintRef.current = response.chunk.fingerprint;
          setResult({
            status: "ok",
            content: response.chunk.content,
            size: response.chunk.size,
            fingerprint: response.chunk.fingerprint,
            task: response.task,
            modelName: extractModelName(response.chunk.content),
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
