/*
 * ResumeCTA — extracted from TaskDetailHeader (Campaign C / C6).
 *
 * Renders the BROWN Resume button. Owned concerns:
 *   - `handleResume` posts /launch (resume=true), dispatches into the
 *     LaunchCoordinator, fire-and-forget /spawn prewarm.
 *   - Transient "Sent — terminal opening" label.
 *
 * Label invariant: ALWAYS "Resume", NEVER "Recover" (project memory
 * `feedback_resume_label_singular` + ADR-095/096 falsification). The
 * activity gate (`isClaudeRecentlyActive`) is gone — Resume shows
 * unconditionally for every (idle | active | draft+launchedBefore) task.
 * Clicking on a still-live session is harmless: `claude --resume` errors
 * "Session ID already in use".
 *
 * The `data-testid="cta-copy-resume-command"` is load-bearing for
 * Playwright specs 30/36/36b/43/48/70-d/70-f and unit tests. The testid
 * is a historical name kept verbatim (the action evolved from "copy
 * resume command" to "auto-execute resume" without renaming the testid,
 * to avoid breaking the regression net).
 *
 * Hook lifecycle note (OAI-2): `useLaunchTask` is instantiated once per
 * mount. LaunchCTA + ResumeCTA are mutex-rendered by the shell — only
 * one mutation hook is alive at a time, behaviorally identical to the
 * pre-split shared instance.
 */
import { useCallback, useRef, useState } from "react";
import { Terminal as TerminalIcon } from "lucide-react";

import type { ExternalTask } from "../../../lib/externalApi";
import { useLaunchTask } from "../../../hooks/useLaunchTask";
import { useLaunchCoordinator } from "../../../contexts/LaunchCoordinatorContext";

export interface ResumeCTAProps {
  task: ExternalTask;
  /**
   * Callback to surface resume / prewarm errors into the shell's
   * `task-detail-cta-error` alert region. `null` clears.
   */
  onError: (error: string | null) => void;
}

async function prewarmPty(taskId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `/api/terminal/${encodeURIComponent(taskId)}/spawn`,
      { method: "POST" },
    );
    if (res.ok) return null;
    const detail = await res.text().catch(() => "");
    return `prewarm ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`;
  } catch (err) {
    return err instanceof Error
      ? `prewarm network error: ${err.message}`
      : "prewarm network error";
  }
}

export function ResumeCTA({ task, onError }: ResumeCTAProps) {
  const launchMut = useLaunchTask();
  const coord = useLaunchCoordinator();
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashCopied = useCallback((label: string) => {
    setCopiedLabel(label);
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(() => setCopiedLabel(null), 1800);
  }, []);

  const handleResume = useCallback(async () => {
    onError(null);
    if (launchMut.isPending || coord.pendingLaunch) return;
    try {
      const { commands } = await launchMut.mutateAsync({
        taskId: task.taskId,
        resume: true,
      });
      coord.dispatchAutoLaunch(commands, true);
      flashCopied("Resuming…");
      void prewarmPty(task.taskId).then((issue) => {
        if (issue) onError(issue);
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [launchMut, task.taskId, flashCopied, coord, onError]);

  return (
    <button
      type="button"
      onClick={() => void handleResume()}
      disabled={launchMut.isPending || coord.pendingLaunch !== null}
      className="inline-flex items-center gap-2 rounded-[var(--radius-button,8px)] bg-[var(--color-resume,#C08862)] px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-[var(--color-resume-hover,#A67352)] disabled:opacity-60"
      data-testid="cta-copy-resume-command"
      data-color="orange"
      aria-label="Resume — auto-execute in embedded terminal"
    >
      <TerminalIcon size={14} />
      {launchMut.isPending
        ? "Preparing…"
        : copiedLabel === "Resuming…"
        ? "Sent — terminal opening"
        : "Resume"}
    </button>
  );
}
