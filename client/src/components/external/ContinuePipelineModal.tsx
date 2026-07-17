/*
 * Continue Pipeline modal.
 *
 * Trigger: TaskBoardPage routes "continue-pipeline" from the "+ New ▾"
 * dropdown here instead of NewIssueModal. The modal lists every
 * `awaiting_launch` phase_task whose prerequisites are completed
 * (`readyToLaunchTasks[]` from the server-derived response). User picks
 * one (or it's auto-selected when the list has length 1) and clicks
 * Launch — the click delegates to `useContinuePipeline()` so the same
 * code path drives Master TaskCard's Continue button and any future
 * TaskDetail header CTA (review O #7 / plan B4).
 *
 * No new UX pattern — visually mirrors NewIssueModal (header tile,
 * helper-box, footer with Esc hint), and the Launch button uses the
 * same brown-primary tokens as every other CTA.
 */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { RotateCw, Terminal, X } from "lucide-react";

import type { Project } from "../../types";
import {
  formatRunLabel,
  type PhaseTask,
  type RunConfigResponse,
} from "../../lib/run-config-v2";
import { useContinuePipeline } from "../../hooks/useContinuePipeline";
import { launchResultFailure, type LaunchFailure } from "../../lib/launchFailure";
import { LaunchFailureNotice } from "./LaunchFailureNotice";
import { ModalScrollBody } from "../common/ModalScrollBody";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project | null;
  /** Fresh run-config snapshot. The hook re-fetches before launching, so a
   * cached value here is fine — the user's selection is verified server-side. */
  runConfig: RunConfigResponse | undefined;
}

export function ContinuePipelineModal({
  open,
  onOpenChange,
  project,
  runConfig,
}: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const continuePipeline = useContinuePipeline();
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<LaunchFailure | null>(null);

  const ready = useMemo<PhaseTask[]>(() => {
    if (!runConfig || runConfig.status !== "ok") return [];
    return runConfig.readyToLaunchTasks;
  }, [runConfig]);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // When the modal opens / ready list changes, default to the first ready task.
  useEffect(() => {
    if (!open) return;
    setFailure(null);
    setSubmitting(false);
    setSelectedId((prev) => {
      if (prev && ready.some((t) => t.phaseTaskId === prev)) return prev;
      return ready[0]?.phaseTaskId ?? null;
    });
  }, [open, ready]);

  const selected = useMemo(
    () => ready.find((t) => t.phaseTaskId === selectedId) ?? null,
    [ready, selectedId],
  );

  // The ONE continuation funnel (rule 14). Retry re-enters THIS — a mismatch
  // (rule 13: 409 phase_task_session_uuid_mismatch) surfaces as a rendered
  // notice, never swallowed. No component ever hand-rolls a launch command.
  const doContinue = async () => {
    if (!project || !selected) return;
    setSubmitting(true);
    setFailure(null);
    const result = await continuePipeline({ project, phaseTaskId: selected.phaseTaskId });
    if (!result.ok) {
      setSubmitting(false);
      setFailure(launchResultFailure(result.reason, result.detail));
      return;
    }
    onOpenChange(false);
    navigate(`/tasks/${result.taskId}`);
  };
  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    void doContinue();
  };

  const runLabel =
    runConfig && runConfig.status === "ok"
      ? formatRunLabel(runConfig.config.runId)
      : "Pipeline";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed left-1/2 top-[10%] z-50 w-[540px] max-w-[95vw] -translate-x-1/2 overflow-hidden rounded-[var(--radius-card,12px)] bg-white shadow-[var(--shadow-modal,0_20px_60px_rgba(0,0,0,0.28))]"
          data-testid="continue-pipeline-modal"
        >
          <div className="flex items-center gap-3 border-b border-[var(--color-border,#e0dbd4)] px-5 py-4">
            <div
              className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[8px]"
              style={{ background: "var(--info-tint)", color: "var(--info)" }}
              aria-hidden
            >
              <RotateCw size={18} strokeWidth={1.7} />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title
                className="text-[16px] font-bold tracking-tight text-[var(--color-text,#1a1a1a)]"
                style={{ letterSpacing: "-0.2px" }}
              >
                Continue Pipeline
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[12px] leading-[1.4] text-[var(--color-muted,#6b7280)]">
                {runLabel} — pick the next phase to launch in your terminal.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                data-testid="continue-pipeline-modal-close"
                className="rounded-[6px] p-1 text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)]"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={(e) => void onSubmit(e)} data-testid="continue-pipeline-form">
            <ModalScrollBody data-testid="continue-pipeline-body" className="max-h-[calc(100vh-280px)] gap-4">
              <Body
                ready={ready}
                runConfig={runConfig}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </ModalScrollBody>
            {failure && (
              <div className="border-t border-[var(--color-border,#e0dbd4)] px-5 py-2">
                <LaunchFailureNotice
                  testId="continue-pipeline-failure"
                  failure={failure}
                  busy={submitting}
                  actions={{
                    retry: { onClick: () => void doContinue() },
                    refresh: {
                      onClick: () =>
                        void qc.invalidateQueries({ queryKey: ["run-config", project?.id ?? ""] }),
                    },
                    "open-project-settings": { href: "/projects" },
                  }}
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border,#e0dbd4)] bg-[var(--color-bg,#f5f0eb)] px-5 py-3">
              <div className="flex-1 text-[11px] text-[var(--color-muted,#6b7280)]">
                <kbd className="rounded-[3px] border border-[var(--color-border,#e0dbd4)] bg-white px-1.5 py-0.5 font-mono text-[10px]">
                  Esc
                </kbd>{" "}
                to cancel
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  data-testid="continue-pipeline-cancel-btn"
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] bg-[var(--color-muted-bg,#ede8e1)] px-4 py-1.5 text-[13px] font-medium text-[var(--color-text,#1a1a1a)] hover:bg-[var(--color-border,#e0dbd4)]"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                data-testid="continue-pipeline-launch-btn"
                disabled={!selected || submitting}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-button,8px)] bg-[var(--color-primary,#6b5e56)] px-4 py-1.5 pointer-coarse:min-h-[44px] text-[13px] font-semibold text-white hover:bg-[var(--color-primary-hover,#5a4f48)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Terminal size={14} />
                {submitting ? "Launching…" : "Launch"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Body({
  ready,
  runConfig,
  selectedId,
  onSelect,
}: {
  ready: PhaseTask[];
  runConfig: RunConfigResponse | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (!runConfig) {
    return (
      <p data-testid="continue-pipeline-empty" className="text-[13px] text-[var(--color-muted,#6b7280)]">
        Loading run-config…
      </p>
    );
  }
  if (runConfig.status !== "ok") {
    return (
      <p data-testid="continue-pipeline-empty" className="text-[13px] text-[var(--color-muted,#6b7280)]">
        No active v2 pipeline for this project ({runConfig.status}). Start one with{" "}
        <code className="rounded-[3px] bg-[var(--color-muted-bg,#ede8e1)] px-1 py-0.5 font-mono text-[12px]">
          /shipwright-run
        </code>
        .
      </p>
    );
  }
  if (ready.length === 0) {
    return (
      <p data-testid="continue-pipeline-empty" className="text-[13px] text-[var(--color-muted,#6b7280)]">
        Pipeline already past this phase — nothing to continue. Wait for the
        next phase to enter <code>awaiting_launch</code>, or use Master
        TaskCard recovery snippets if a task is stuck.
      </p>
    );
  }
  if (ready.length === 1) {
    const t = ready[0];
    return (
      <div
        data-testid={`continue-pipeline-single-${t.phaseTaskId}`}
        className="rounded-[var(--radius-button,8px)] border border-[var(--color-border,#e0dbd4)] bg-[var(--color-bg,#f9f6f3)] px-3 py-3 text-[13px]"
      >
        <PhaseRow task={t} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] text-[var(--color-muted,#6b7280)]">
        {ready.length} phase tasks are ready to launch (parallel branches).
        Pick which one to continue with:
      </p>
      <ul className="flex flex-col gap-1.5" role="radiogroup">
        {ready.map((t) => {
          const checked = selectedId === t.phaseTaskId;
          return (
            <li key={t.phaseTaskId}>
              <label
                data-testid={`continue-pipeline-option-${t.phaseTaskId}`}
                className={
                  "flex cursor-pointer items-start gap-2 rounded-[var(--radius-button,8px)] border-[1.5px] px-3 py-2 text-[13px] " +
                  (checked
                    ? "border-[var(--color-primary,#6b5e56)] bg-[var(--color-bg,#f9f6f3)]"
                    : "border-[var(--color-border,#e0dbd4)] hover:bg-[var(--color-muted-bg,#ede8e1)]")
                }
              >
                <input
                  type="radio"
                  name="continue-pipeline-target"
                  className="mt-1"
                  checked={checked}
                  onChange={() => onSelect(t.phaseTaskId)}
                />
                <div className="min-w-0 flex-1">
                  <PhaseRow task={t} />
                </div>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PhaseRow({ task }: { task: PhaseTask }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 font-medium text-[var(--color-text,#1a1a1a)]">
        <span>{task.phase}</span>
        {task.splitId && (
          <>
            <span className="text-[var(--color-muted,#6b7280)]">/</span>
            <span>{task.splitId}</span>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-muted,#6b7280)]">
        <span className="font-mono">{task.slashCommand}</span>
        <span>·</span>
        <span className="font-mono">{task.sessionUuid.slice(-8)}</span>
        {task.prerequisites.length > 0 && (
          <>
            <span>·</span>
            <span>
              {task.prerequisites.length} prereq
              {task.prerequisites.length === 1 ? "" : "s"} done
            </span>
          </>
        )}
      </div>
    </div>
  );
}

