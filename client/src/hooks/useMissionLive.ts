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
import type { Campaign } from "../lib/campaignsApi";
import { parseCampaignSlug } from "../lib/campaignSlug";
import {
  summarizeTranscript,
  type LifecycleStage,
  type StageOptions,
  type TranscriptActivity,
  type TranscriptSummary,
} from "../lib/narrator-transcript";
import { deriveRecordNodes, type MissionState, type RecordNodeView } from "../lib/recordNodes";
import { useCampaigns } from "./useCampaigns";
import { useMissionState } from "./useMissionState";
import { useRunDetail } from "./useRunData";

export type MissionMode = "completed" | "live" | "adhoc" | "empty";

/** Autonomous-campaign progress for a `campaign: <slug>` orchestrator session
 *  (FR-01.67). Populated ONLY when the task title parses to a slug AND that
 *  campaign is present in the `useCampaigns` payload — else null (dormant). */
export interface CampaignMissionInfo {
  slug: string;
  done: number;
  total: number;
  /** The active sub-iterate id (an `in_progress` step, else `nextPending`), or null. */
  activeSubIterate: string | null;
}

export interface MissionLiveModel {
  missionState: MissionState;
  mode: MissionMode;
  /** Plain "what this is" — the run summary/intent, the task title, or a topic
   *  read from the JSONL; null → the panel shows an honest waiting line. */
  businessSummary: string | null;
  /** Derived lifecycle stage, or null (rendered as "—"). */
  stage: LifecycleStage | null;
  /** The coarse "what it's doing now" read shown INSTEAD of a stage when the
   *  session has no iterate lifecycle (S4 AC5). Null whenever `stage` is set. */
  stageActivity: string | null;
  /** True only when the run reached a done, terminal `Merge` (a completed run). */
  stageComplete: boolean;
  /** The live JSONL narration for the middle panel. */
  narration: { summary: string | null; activity: TranscriptActivity[] };
  /** The Req/Spec/Test/Review/Commit nodes rendered AS artifact links. */
  nodes: RecordNodeView[];
  /** Autonomous-campaign progress, or null for a normal session (FR-01.67). */
  campaign: CampaignMissionInfo | null;
}

/**
 * Pure lookup: match the parsed slug against the `useCampaigns` payload and read
 * its progress. Exported for isolated testing; honest by construction (a missing
 * slug / payload / match yields null — never a fabricated progress). The active
 * sub-iterate is the `in_progress` step, falling back to `nextPending`.
 */
export function deriveCampaignInfo(
  slug: string | null,
  campaigns: Campaign[] | null | undefined,
): CampaignMissionInfo | null {
  if (!slug || !campaigns) return null;
  const c = campaigns.find((x) => x.slug === slug);
  if (!c) return null;
  const activeStep = c.steps.find((s) => s.status === "in_progress");
  const activeSubIterate = activeStep?.id ?? c.nextPending?.id ?? null;
  return { slug, done: c.done, total: c.total, activeSubIterate };
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
  /** Autonomous-campaign progress, threaded in like `transcript` (keeps this
   *  derivation pure). Null/undefined for a normal session (FR-01.67). */
  campaign?: CampaignMissionInfo | null;
}): MissionLiveModel {
  const { missionState, run, transcript, taskTitle } = input;
  const campaign = input.campaign ?? null;
  const title = firstNonEmpty(taskTitle);

  const mode: MissionMode =
    missionState === "live"
      ? "live"
      : run != null
        ? "completed"
        : transcript.hasActivity
          ? "adhoc"
          : "empty";

  // A campaign session shows the human-readable slug, not the raw
  // `campaign: <slug>` title (FR-01.67).
  const businessSummary = campaign
    ? campaign.slug
    : mode === "completed"
      ? firstNonEmpty(run?.summary, run?.intent, title)
      : firstNonEmpty(title, transcript.topic);

  // A completed (merged) run is the terminal Merge stage, all done (FR-01.67);
  // otherwise the windowed transcript stage (the active sub-iterate's, for a
  // campaign) or an honest null.
  const completed = mode === "completed";
  const stage: LifecycleStage | null = completed ? "Merge" : transcript.stage;
  // A completed run states its terminal stage, so the coarse read is suppressed —
  // the two are alternatives, never shown together.
  const stageActivity = completed ? null : transcript.stageActivity;

  return {
    missionState,
    mode,
    businessSummary,
    stage,
    stageActivity,
    stageComplete: completed,
    narration: { summary: transcript.summary, activity: transcript.activity },
    nodes: deriveRecordNodes({ missionState, facts: run }),
    campaign,
  };
}

/**
 * The Mission LIVE view model for a task. `transcriptContent` is the raw JSONL
 * from TaskDetailPage's single `useTaskTranscript` poll — do NOT open a second
 * poller here.
 *
 * `stageOptions` carries the resolver's scenario (S4): the caller already holds
 * the `MissionContext`, so it is threaded IN rather than re-fetched here — this
 * hook stays free of a second server round-trip.
 */
export function useMissionLive(
  task: ExternalTask | null | undefined,
  transcriptContent: string,
  stageOptions?: StageOptions,
): MissionLiveModel {
  const missionState = useMissionState(task ?? null);
  const runDetail = useRunDetail(task?.projectId ?? null, task?.runId ?? null);
  const run = runDetail.data?.status === "ok" ? runDetail.data.run : null;
  const scenario = stageOptions?.scenario ?? null;
  const phase = stageOptions?.phase ?? null;
  const transcript = useMemo(
    () => summarizeTranscript(transcriptContent, { scenario, phase }),
    [transcriptContent, scenario, phase],
  );

  // Campaign awareness (FR-01.67): the existing 3 s campaign poll, enabled ONLY
  // when the title is a `campaign: <slug>` breadcrumb — dormant otherwise (NOT a
  // second transcript poller; reuses the pre-existing campaigns endpoint).
  const slug = parseCampaignSlug(task?.title ?? null);
  const campaignsQuery = useCampaigns(task?.projectId ?? null, { enabled: slug != null });
  const campaign = useMemo(
    () => deriveCampaignInfo(slug, campaignsQuery.data),
    [slug, campaignsQuery.data],
  );

  return useMemo(
    () =>
      deriveMissionLive({
        missionState,
        run,
        transcript,
        taskTitle: task?.title ?? null,
        campaign,
      }),
    [missionState, run, transcript, task?.title, campaign],
  );
}
