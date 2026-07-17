/*
 * useMissionLive — the Mission-tab LIVE view model (FR-01.66,
 * iterate-2026-07-17-mission-live-jsonl).
 *
 * Composes THREE existing observers into one honest view model:
 *   - the raw-JSONL transcript summary (`summarizeTranscript`), fed the SAME
 *     `useTaskTranscript` poll TaskDetailPage already runs — the content is passed
 *     IN, so this hook adds NO second poller and NO new server surface (rule 4 /
 *     DO-NOT #1: read-only observer of the JSONL);
 *   - the per-run join (`useRunDetail`) for a completed run's summary + artifacts;
 *   - the Mission cluster state (`useMissionState`): `state === "active"` is LIVE
 *     (NOT `liveSession`, which is pty-existence — the documented trap).
 *
 * The mode decides the whole tab:
 *   - `live`      — an actively-working session (state active); the middle narrates
 *                   the JSONL, the stage is inferred from it (or "—").
 *   - `completed` — a formal run with a `work_completed` join row; the middle keeps
 *                   its verdict/proof, the stage is a done `Finalize`.
 *   - `adhoc`     — a finished/idle session with a transcript but no run row; the
 *                   middle narrates the JSONL.
 *   - `empty`     — no run AND no transcript; honest "waiting", never fabricated.
 */

import { useMemo } from "react";

import type { ExternalTask } from "../lib/externalApi";
import type { RunDataJoin } from "../lib/runDataApi";
import {
  summarizeTranscript,
  type LifecycleStage,
  type TranscriptActivity,
  type TranscriptSummary,
} from "../lib/narrator-transcript";
import { deriveRecordNodes, type MissionState, type RecordNodeView } from "../lib/recordNodes";
import { useMissionState } from "./useMissionState";
import { useRunDetail } from "./useRunData";

export type MissionMode = "completed" | "live" | "adhoc" | "empty";

export interface MissionLiveModel {
  missionState: MissionState;
  mode: MissionMode;
  /** Plain "what this is" — the run summary/intent, the task title, or a topic
   *  read from the JSONL; null → the panel shows an honest waiting line. */
  businessSummary: string | null;
  /** Inferred lifecycle stage, or null (rendered as "—"). */
  stage: LifecycleStage | null;
  /** True only when the run reached a done `Finalize` (a completed run). */
  stageComplete: boolean;
  /** The live JSONL narration for the middle panel. */
  narration: { summary: string | null; activity: TranscriptActivity[] };
  /** The Req/Spec/Test/Review/Commit nodes rendered AS artifact links. */
  nodes: RecordNodeView[];
}

function firstNonEmpty(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

/**
 * The pure view-model derivation — exported for isolated unit testing (no hooks).
 * Honest by construction: `empty` mode invents nothing, and the stage is only ever
 * a `Finalize` (a real completed run) or the transcript's inferred stage (else
 * null). It never reads `liveSession`.
 */
export function deriveMissionLive(input: {
  missionState: MissionState;
  run: RunDataJoin | null;
  transcript: TranscriptSummary;
  taskTitle: string | null;
}): MissionLiveModel {
  const { missionState, run, transcript, taskTitle } = input;
  const title = firstNonEmpty(taskTitle);

  const mode: MissionMode =
    missionState === "live"
      ? "live"
      : run != null
        ? "completed"
        : transcript.hasActivity
          ? "adhoc"
          : "empty";

  const businessSummary =
    mode === "completed"
      ? firstNonEmpty(run?.summary, run?.intent, title)
      : firstNonEmpty(title, transcript.topic);

  const stage: LifecycleStage | null = mode === "completed" ? "Finalize" : transcript.stage;

  return {
    missionState,
    mode,
    businessSummary,
    stage,
    stageComplete: mode === "completed",
    narration: { summary: transcript.summary, activity: transcript.activity },
    nodes: deriveRecordNodes({ missionState, facts: run }),
  };
}

/**
 * The Mission LIVE view model for a task. `transcriptContent` is the raw JSONL
 * from TaskDetailPage's single `useTaskTranscript` poll — do NOT open a second
 * poller here.
 */
export function useMissionLive(
  task: ExternalTask | null | undefined,
  transcriptContent: string,
): MissionLiveModel {
  const missionState = useMissionState(task ?? null);
  const runDetail = useRunDetail(task?.projectId ?? null, task?.runId ?? null);
  const run = runDetail.data?.status === "ok" ? runDetail.data.run : null;
  const transcript = useMemo(() => summarizeTranscript(transcriptContent), [transcriptContent]);

  return useMemo(
    () => deriveMissionLive({ missionState, run, transcript, taskTitle: task?.title ?? null }),
    [missionState, run, transcript, task?.title],
  );
}
