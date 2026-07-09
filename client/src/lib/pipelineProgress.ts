/*
 * pipelineProgress — the single-session pipeline card's "steady 7-phase"
 * progress model (campaign webui-pipeline-convergence, sub-iterate W3).
 *
 * The pipeline is DYNAMIC: `build` (and `plan`) fan out into per-split sub-tasks
 * that are APPENDED incrementally as `design` freezes splits (design spec §3–4).
 * Counting "completed phases" from a snapshot is therefore NOT monotonic — as
 * build/split-N finishes and build/split-(N+1) is appended, the `build` phase
 * flips complete → incomplete and a naive bar jumps backward. Counting
 * *phase_tasks* is worse (it drops by the whole fan-out on every split).
 *
 * So the headline bar tracks the HIGH-WATER FRONTIER: the furthest canonical
 * phase (index in `config.pipeline`) that has actually STARTED (a non-`backlog`
 * task). Because the pipeline is serial, every phase BEFORE the frontier is
 * finished; the frontier phase itself is the one in flight (not yet counted).
 * `frontierIndex` is monotonic non-decreasing — a task status only advances
 * (backlog → … → done) and higher-index phases are reached strictly later — so
 * `donePhases` never recalibrates backward, however `build` fans out. A
 * `complete` run pins the bar to full; a `failed` run leaves it at the frontier.
 *
 * The card's checklist BELOW shows the real, growing `phase_tasks` list, so the
 * fan-out stays visible where a per-step view belongs.
 */

import type { RunConfigV2 } from "./run-config-v2";

export interface PhaseProgress {
  /** Canonical phases fully behind the active frontier (see module doc). */
  donePhases: number;
  /** Denominator — `config.pipeline.length` (the fixed canonical phase count). */
  totalPhases: number;
  /** 0–100, rounded. 0 when there are no canonical phases. */
  pct: number;
}

/** A phase has STARTED once it owns a task past `backlog` (backlog = enqueued,
 *  not yet begun — excluded so a pre-seeded backlog row can't jump the bar). */
function phaseStarted(config: RunConfigV2, phase: string): boolean {
  for (const pt of config.phase_tasks) {
    if (pt.phase === phase && pt.status !== "backlog") return true;
  }
  return false;
}

export function derivePhaseProgress(config: RunConfigV2): PhaseProgress {
  const totalPhases = config.pipeline.length;
  if (totalPhases === 0) {
    return { donePhases: 0, totalPhases: 0, pct: 0 };
  }

  // A complete run is fully done regardless of per-phase task bookkeeping.
  if (config.status === "complete") {
    return { donePhases: totalPhases, totalPhases, pct: 100 };
  }

  // Furthest canonical phase that has started; everything before it is finished
  // (serial pipeline). The frontier phase is in flight → not counted.
  let frontierIndex = -1;
  for (let i = 0; i < config.pipeline.length; i += 1) {
    if (phaseStarted(config, config.pipeline[i])) frontierIndex = i;
  }
  const donePhases = frontierIndex < 0 ? 0 : frontierIndex;
  return {
    donePhases,
    totalPhases,
    pct: Math.round((donePhases / totalPhases) * 100),
  };
}
