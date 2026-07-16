/*
 * DesignGateDecision — the pinned decision bar of the design-gate card
 * (FR-01.58, A14). "Approve — start building" (the ONE primary CTA on the
 * screen, AC4) · "Request changes" · the "Waiting on you" amber badge.
 *
 * Approve = the EXISTING resume/CTA path (AC3, rule 1). It runs the SAME
 * `useLaunchTask` + `LaunchCoordinator` dispatch as the header ResumeCTA: the
 * server builds the command (`core/launcher.ts`) and the client auto-executes it
 * in the embedded terminal after this explicit click. The WebUI spawns / drives
 * NOTHING and never invokes `orchestrator.py`, never writes run-loop state. A
 * failed resume surfaces the failure honestly — it does NOT silently flip the
 * badge (the gate lifts only when the poll sees `paused_human_gate` cleared).
 *
 * Approve is deliberate, not a one-click accident: the first click ARMS a
 * confirm/cancel step; only the explicit Confirm dispatches. Every control is a
 * real <button> (keyboard-reachable, visible focus ring). "Request changes"
 * opens the shared review viewer (its Export writes the disk-derived round file
 * through the existing feedback-write path) — owned by the parent card.
 */

import { useCallback, useState } from "react";
import { Check, MessageSquare, X } from "lucide-react";

import type { ExternalTask } from "../../../lib/externalApi";
import { useLaunchTask } from "../../../hooks/useLaunchTask";
import { useLaunchCoordinator } from "../../../contexts/LaunchCoordinatorContext";

interface Props {
  task: ExternalTask;
  /** Opens the shared review viewer for the "request changes" feedback flow. */
  onRequestChanges: () => void;
  /** The last round saved through the review viewer, for an honest hint. */
  savedRound: number | null;
}

export function DesignGateDecision({ task, onRequestChanges, savedRound }: Props) {
  const launchMut = useLaunchTask();
  const coord = useLaunchCoordinator();
  const [armed, setArmed] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = launchMut.isPending || coord.pendingLaunch !== null;

  const dispatchApprove = useCallback(async () => {
    setError(null);
    if (pending) return;
    try {
      // The EXACT header-Resume path: build the resume command server-side,
      // auto-execute it in the embedded terminal. No orchestrator, no gate write.
      const { commands } = await launchMut.mutateAsync({
        taskId: task.taskId,
        resume: true,
      });
      coord.dispatchAutoLaunch(commands, true);
      setArmed(false);
      setSent(true);
    } catch (err) {
      setArmed(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [pending, launchMut, task.taskId, coord]);

  return (
    <div className="mc-gate-bar" data-testid="design-gate-decision">
      {armed ? (
        <>
          <button
            type="button"
            className="mc-gate-btn mc-gate-btn-primary"
            onClick={() => void dispatchApprove()}
            disabled={pending}
            data-testid="design-gate-approve-confirm"
            autoFocus
          >
            <Check size={15} aria-hidden="true" />
            {pending ? "Starting…" : "Confirm — start building"}
          </button>
          <button
            type="button"
            className="mc-gate-btn mc-gate-btn-ghost"
            onClick={() => setArmed(false)}
            disabled={pending}
            data-testid="design-gate-approve-cancel"
          >
            <X size={14} aria-hidden="true" />
            Cancel
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="mc-gate-btn mc-gate-btn-primary"
            onClick={() => {
              setError(null);
              setArmed(true);
            }}
            disabled={pending || sent}
            data-testid="design-gate-approve"
          >
            <Check size={15} aria-hidden="true" />
            {sent ? "Resuming — terminal opening" : "Approve — start building"}
          </button>
          <button
            type="button"
            className="mc-gate-btn mc-gate-btn-outline"
            onClick={onRequestChanges}
            data-testid="design-gate-request-changes"
          >
            <MessageSquare size={14} aria-hidden="true" />
            Request changes
          </button>
        </>
      )}

      <span className="mc-gate-grow" />

      {savedRound !== null && (
        <span className="mc-gate-saved" data-testid="design-gate-saved-hint">
          Round {savedRound} feedback saved
        </span>
      )}

      {/* "Waiting on you" — badge + text, never colour alone (AC9). */}
      <span className="mc-gate-badge" data-testid="design-gate-waiting-badge">
        Waiting on you
      </span>

      {error && (
        <span role="alert" className="mc-gate-error" data-testid="design-gate-approve-error">
          {error}
        </span>
      )}
    </div>
  );
}
