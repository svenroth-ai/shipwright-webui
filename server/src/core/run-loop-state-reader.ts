/*
 * core/run-loop-state-reader.ts — read-only observer of the single-session
 * orchestrator's loop-state file, for the design-gate affordance
 * (iterate-2026-07-10-design-gate-review-host, FR-01.45).
 *
 * The `/shipwright-run` master records a human-gate PAUSE at the design
 * `orchestrator-approve` gate by flipping `.shipwright/run_loop_state.json`
 * (`single_session/loop_state.py`) to `status: "paused_human_gate"`. This is a
 * SEPARATE file from `shipwright_run_config.json` — the run-config never carries
 * the gate — so it gets its own reader (run-config-reader.ts is at its bloat
 * ceiling and stays untouched).
 *
 * WebUI is a pure read-only observer here (CLAUDE.md rule 12 / DO-NOT #1): it
 * never writes the loop-state, run-config, or Claude JSONL. A missing / torn /
 * malformed loop-state simply reports "no gate" — never a throw.
 *
 * `deriveDesignGate` is pure so it unit-tests without the filesystem; the gate
 * is active ONLY when the loop is paused at a human gate AND its current phase
 * task is the `design` phase AND the emitted viewer exists on disk. That triple
 * predicate is the anti-staleness guard: the moment the master resumes it flips
 * the loop off `paused_human_gate`, so a lingering `index.html` cannot resurrect
 * the button.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  TERMINAL_PHASE_TASK_STATUSES,
  type RunConfigV2,
  type RunPhase,
} from "../types/run-config-v2.js";

/** The paused-at-human-gate loop status (mirrors LOOP_STATUSES in the framework). */
export const PAUSED_HUMAN_GATE = "paused_human_gate";

const LOOP_STATE_REL = path.join(".shipwright", "run_loop_state.json");

/** The subset of the loop-state file the gate cares about. */
export interface LoopState {
  status?: string;
  currentPhaseTaskId?: string | null;
  runId?: string;
}

export interface DesignGate {
  /** Paused at the design human-gate AND the viewer exists → show "Review mockups". */
  active: boolean;
  /** The paused design phase task id, when active. */
  phaseTaskId: string | null;
  phase: RunPhase | null;
}

export const INACTIVE_DESIGN_GATE: DesignGate = {
  active: false,
  phaseTaskId: null,
  phase: null,
};

export function loopStatePath(projectPath: string): string {
  return path.join(projectPath, LOOP_STATE_REL);
}

/** Read + parse the loop-state, or null (missing / torn / malformed → no gate). */
export function readLoopState(projectPath: string): LoopState | null {
  let raw: string;
  try {
    raw = readFileSync(loopStatePath(projectPath), "utf-8");
  } catch {
    return null; // ENOENT (no single-session run) or a transient read error.
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as LoopState;
    return null;
  } catch {
    return null; // torn write mid-read — the next poll retries.
  }
}

/**
 * Derive the design-gate state from the loop-state + run-config + whether the
 * emitted viewer exists. Pure — the caller supplies `hasViewer`
 * (`existsSync(.shipwright/designs/index.html)`).
 */
export function deriveDesignGate(
  loopState: LoopState | null,
  config: RunConfigV2 | null,
  hasViewer: boolean,
): DesignGate {
  if (!loopState || loopState.status !== PAUSED_HUMAN_GATE) {
    return INACTIVE_DESIGN_GATE;
  }
  const phaseTaskId = loopState.currentPhaseTaskId ?? null;
  if (!phaseTaskId || !config) return INACTIVE_DESIGN_GATE;

  const pt = config.phase_tasks.find((t) => t.phaseTaskId === phaseTaskId);
  if (!pt || pt.phase !== "design") return INACTIVE_DESIGN_GATE;
  // Belt-and-suspenders anti-staleness (plan review R8): a design task that has
  // already reached a terminal status cannot be at a live human gate, even if a
  // torn loop-state momentarily still reads paused.
  if (TERMINAL_PHASE_TASK_STATUSES.includes(pt.status)) return INACTIVE_DESIGN_GATE;

  return { active: hasViewer, phaseTaskId, phase: pt.phase };
}
