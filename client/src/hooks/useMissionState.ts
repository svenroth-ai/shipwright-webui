/*
 * useMissionState — the ONE Mission-cluster state derivation (FR-01.55, A11,
 * campaign webui-wow-usability-2026-07-10).
 *
 * A11 owns this. A12 (Operation card), A13 (three-card shell) and A14 (design
 * gate) all CONSUME it — none of them re-derive their own copy.
 *
 * Result: "done" | "live" | "designgate".
 *
 *  - `designgate` ← the read-only design-gate signal (useDesignGate, FR-01.45 —
 *    a server observer of run_loop_state.json → paused_human_gate). The WebUI
 *    NEVER writes run-loop state (DO-NOT #12). It WINS over `live`.
 *  - `live` ← the task's own SESSION state (`state === "active"`, the store /
 *    JSONL projection of in_progress). It is emphatically NOT `task.liveSession`
 *    — that flag is PTY EXISTENCE, and the shell outlives Claude; gating Mission
 *    UX on it renders a finished task as mid-run (the documented liveSession
 *    trap). Staleness of an `active` run is decided server-side from run-config
 *    timestamps only, never JSONL mtime (DO-NOT #16) — the client just reads the
 *    already-correct projected `state`.
 *  - `done` ← everything else.
 */

import type { ExternalTask, ExternalTaskState } from "../lib/externalApi";
import { useDesignGate } from "./useDesignGate";

export type MissionState = "done" | "live" | "designgate";

/** Non-terminal states poll the design gate (mirrors useDesignGate's own
 *  "single_session + non-terminal run" guard); a `done` run never polls. */
function isTerminal(state: ExternalTaskState): boolean {
  return state === "done";
}

/**
 * The pure truth-table, exported for isolated unit testing. `designgate` beats
 * `live`; `active` (the in_progress session projection) is `live`; anything
 * else — including a stale/idle session OR a live PTY on a finished task — is
 * `done`. It deliberately reads NOTHING about `liveSession`.
 */
export function missionStateFrom(input: {
  taskState: ExternalTaskState;
  designGateActive: boolean;
}): MissionState {
  if (input.designGateActive) return "designgate";
  if (input.taskState === "active") return "live";
  return "done";
}

/** The Mission state for a task. Null/absent task → `done` (nothing to run). */
export function useMissionState(task: ExternalTask | null | undefined): MissionState {
  const projectId = task?.projectId ?? null;
  const gateEnabled = task ? !isTerminal(task.state) : false;
  const gate = useDesignGate(projectId, gateEnabled);
  const designGateActive = gate.data?.active === true;

  if (!task) return "done";
  return missionStateFrom({ taskState: task.state, designGateActive });
}
