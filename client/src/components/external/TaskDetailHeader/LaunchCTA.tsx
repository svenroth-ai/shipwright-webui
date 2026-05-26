/*
 * LaunchCTA — extracted from TaskDetailHeader (Campaign C / C6).
 *
 * Renders the GREEN Launch button. Owned concerns:
 *   - `handleLaunch` posts /launch (resume=false), dispatches into the
 *     LaunchCoordinator, fire-and-forget /spawn prewarm.
 *   - Transient "Sent — terminal opening" label.
 *
 * Stable props: `{ task, onError }` — `onError(string | null)` reports
 * launch failures + prewarm 4xx/5xx back to the shell, which owns the
 * `task-detail-cta-error` alert region. Per C6 plan-review finding
 * OAI-3 + GEM-2: errors propagate via callback so the shell can clear
 * stale errors on a CTA mode change.
 *
 * The button's `data-testid="cta-launch-in-terminal"` is load-bearing for
 * Playwright specs 30/36/36b/43/48/70-d/70-f and unit tests.
 *
 * Hook lifecycle note (OAI-2): `useLaunchTask` is instantiated once per
 * mount of this component. Since LaunchCTA and ResumeCTA are mutex-rendered
 * by the shell's `ctaFor()` function, only one mutation hook is alive at
 * a time — behaviorally identical to the pre-split shared instance.
 */
import { useCallback, useRef, useState } from "react";
import { Terminal as TerminalIcon } from "lucide-react";

import type { ExternalTask } from "../../../lib/externalApi";
import { useLaunchTask } from "../../../hooks/useLaunchTask";
import { useLaunchCoordinator } from "../../../contexts/LaunchCoordinatorContext";

export interface LaunchCTAProps {
  task: ExternalTask;
  /**
   * Callback to surface launch / prewarm errors into the shell's
   * `task-detail-cta-error` alert region. `null` clears the error.
   */
  onError: (error: string | null) => void;
}

/**
 * Best-effort prewarm of the embedded terminal pty. The WS upgrade path
 * is the authoritative pty creation path (ADR-067 + ADR-068-A1); /spawn
 * is a latency optimization. Network errors are tolerated; HTTP 4xx/5xx
 * surface a non-blocking warning via `onError`.
 */
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

export function LaunchCTA({ task, onError }: LaunchCTAProps) {
  const launchMut = useLaunchTask();
  const coord = useLaunchCoordinator();
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashCopied = useCallback((label: string) => {
    setCopiedLabel(label);
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(() => setCopiedLabel(null), 1800);
  }, []);

  // ADR-068-A1: dispatch into LaunchCoordinator (replaces clipboard flow).
  // Live-smoke fix (2026-05-05): prewarm fires fire-and-forget AFTER
  // dispatch, NOT before. /spawn is only a latency optimization; WS
  // upgrade is authoritative pty creation. Decoupling means dispatch
  // fires immediately even if prewarm hangs.
  const handleLaunch = useCallback(async () => {
    onError(null);
    if (launchMut.isPending || coord.pendingLaunch) return;
    try {
      const { commands } = await launchMut.mutateAsync({
        taskId: task.taskId,
        resume: false,
      });
      coord.dispatchAutoLaunch(commands, false);
      flashCopied("Launching…");
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
      onClick={() => void handleLaunch()}
      disabled={launchMut.isPending || coord.pendingLaunch !== null}
      className="inline-flex items-center gap-2 rounded-[var(--radius-button,8px)] px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm transition disabled:opacity-60"
      style={{ background: "var(--color-success, #059669)" }}
      onMouseEnter={(ev) => {
        ev.currentTarget.style.background = "#047857";
      }}
      onMouseLeave={(ev) => {
        ev.currentTarget.style.background = "var(--color-success, #059669)";
      }}
      data-testid="cta-launch-in-terminal"
      data-color="green"
      aria-label="Launch — auto-execute in embedded terminal"
    >
      <TerminalIcon size={14} />
      {launchMut.isPending
        ? "Preparing…"
        : copiedLabel === "Launching…"
        ? "Sent — terminal opening"
        : "Launch"}
    </button>
  );
}
