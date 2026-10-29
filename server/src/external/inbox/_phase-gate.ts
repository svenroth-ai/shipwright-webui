/*
 * external/inbox/_phase-gate.ts — the `phase_gate` inbox kind
 * (iterate-2026-10-29-inbox-guided-phase-questions).
 *
 * A guided-mode phase asks its questions as a menu in the embedded terminal.
 * The live-terminal detector (`terminal_prompt`, `./_derive.ts`) is best-effort
 * and reads only what the headless mirror currently shows, so someone watching
 * ONLY the inbox could miss that a run waits for an answer. The orchestrator
 * records the wait durably: `.shipwright/run_loop_state.json` flips to
 * `paused_human_gate` with `currentPhaseTaskId` naming the paused phase task.
 * This module reads that file (read-only observer, CLAUDE.md rule 12) and
 * surfaces one entry for the task bound to that phase task.
 *
 * Precedence: the specific question wins. A task that already has an
 * `ask_tool`, `terminal_prompt` or `text_question` entry shows THAT (it carries
 * the real question text); `phase_gate` is the fallback that guarantees the
 * wait is never invisible. A missing / torn loop-state yields no entry.
 *
 * Scope: the loop-state is read at `task.cwd`, which for a phase-task launch is
 * the project root (the same directory the design gate reads at `project.path`).
 * Anti-staleness: a phase task already in a TERMINAL run-config status cannot be
 * at a live gate, even if a lagging loop-state still reads paused (mirrors
 * `deriveDesignGate`). One entry per (project dir, phase task). Run this AFTER
 * the question-producing appenders so the deferral sees their entries.
 */

import path from "node:path";

import type { SdkSessionsStore } from "../../core/sdk-sessions-store.js";
import {
  readRunConfig as defaultReadRunConfig,
  type RunConfigReadResult,
} from "../../core/run-config-reader.js";
import {
  PAUSED_HUMAN_GATE,
  readLoopState,
} from "../../core/run-loop-state-reader.js";
import { TERMINAL_PHASE_TASK_STATUSES } from "../../types/run-config-v2.js";
import type { AggregatedEntry } from "./_types.js";

export const PHASE_GATE_PROMPT_TEXT =
  "A phase of this run is paused at a decision gate and waits for your answer. " +
  "Open the task and answer the menu in its terminal.";

const QUESTION_KINDS = new Set<AggregatedEntry["kind"]>([
  "ask_tool",
  "terminal_prompt",
  "text_question",
  "lead_question",
]);

function dirKey(cwd: string): string {
  const resolved = path.resolve(cwd);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export async function appendPhaseGates(
  entries: AggregatedEntry[],
  args: {
    store: SdkSessionsStore;
    readRunConfig?: (projectPath: string) => Promise<RunConfigReadResult>;
  },
): Promise<void> {
  const { store } = args;
  const readConfig = args.readRunConfig ?? defaultReadRunConfig;
  const answered = new Set(
    entries.filter((e) => QUESTION_KINDS.has(e.kind)).map((e) => e.taskId),
  );
  const seen = new Set<string>();
  for (const task of store.list()) {
    if (task.state === "done" || task.state === "launch_failed") continue;
    if (!task.phaseTaskId || !task.cwd) continue;
    if (answered.has(task.taskId)) continue;
    const key = dirKey(task.cwd);
    const loop = readLoopState(task.cwd);
    if (!loop || loop.status !== PAUSED_HUMAN_GATE) continue;
    if (loop.currentPhaseTaskId !== task.phaseTaskId) continue;
    const dedupe = `${key}|${task.phaseTaskId}`;
    if (seen.has(dedupe)) continue;
    let terminal = false;
    try {
      const cfg = await readConfig(task.cwd);
      if (cfg.status === "ok") {
        const pt = cfg.config.phase_tasks.find(
          (t) => t.phaseTaskId === task.phaseTaskId,
        );
        terminal = !!pt && TERMINAL_PHASE_TASK_STATUSES.includes(pt.status);
      }
    } catch {
      // Best-effort guard: an unreadable run-config must not hide a real wait.
    }
    if (terminal) continue;
    seen.add(dedupe);
    entries.push({
      kind: "phase_gate",
      taskId: task.taskId,
      sessionUuid: task.sessionUuid,
      taskTitle: task.title,
      promptText: PHASE_GATE_PROMPT_TEXT,
      bestEffort: true,
    });
  }
}
