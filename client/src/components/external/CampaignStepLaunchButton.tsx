/*
 * CampaignStepLaunchButton — the per-campaign "Launch (Cx)" action (FR-01.36).
 *
 * Replaces the old per-step "Copy launch" clipboard affordance: instead of
 * copying `/shipwright-iterate "<specPath>"`, it opens a real TaskDetail
 * terminal that auto-runs it for the campaign's NEXT-PENDING sub-iterate —
 * exactly like CampaignAutonomousLaunchButton, but one step instead of the
 * whole campaign (create task → server builds the command from { slug, stepId }
 * → sessionStorage handoff → navigate → embedded terminal auto-executes).
 *
 * Direct one-click launch for an ordinary step. When the next-pending step is
 * risky (previously `failed`/`escalated`, or `plan_first` via its sub-iterate
 * frontmatter) a confirm dialog gates the launch — mirrors the autonomous
 * action's risky-step guard, scaled to a single step. Disabled (never a dead
 * button) when there is no launchable next step (all complete / spec file
 * missing → null specPath) or no resolved project.
 */

import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { Play, TriangleAlert, X } from "lucide-react";

import type { Campaign, CampaignStep } from "../../lib/campaignsApi";
import type { Project } from "../../types";
import { useLaunchCampaignStep, type LaunchCampaignResult } from "../../hooks/useLaunchCampaignStep";

function riskyReason(step: CampaignStep): string | null {
  if (step.status === "failed") return "previously failed";
  if (step.status === "escalated") return "escalated";
  if (step.planFirst) return "plan-first";
  return null;
}

function errorMessage(result: Extract<LaunchCampaignResult, { ok: false }>): string {
  const base =
    result.reason === "create_failed" ? "Could not create the task." : "Launch failed.";
  return result.detail ? `${base} (${result.detail})` : base;
}

export function CampaignStepLaunchButton({
  campaign,
  project,
}: {
  campaign: Campaign;
  project: Project | null | undefined;
}) {
  const navigate = useNavigate();
  const launchStep = useLaunchCampaignStep();

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const slug = campaign.slug;
  const next = campaign.nextPending;
  const nextStep = next ? campaign.steps.find((s) => s.id === next.id) : undefined;
  // Fail SAFE: when there is a launchable next step but its full row can't be
  // resolved (a client-side data race between `nextPending` and `steps`, or a
  // producer edge), treat it as risky so the confirm dialog gates the launch —
  // never silently direct-launch a step we can't classify.
  const reason = next ? (nextStep ? riskyReason(nextStep) : "needs review") : null;
  // A run is already attached (live loop unit / in_progress step). A second
  // single-step launch would race the running orchestrator. Block it.
  const attached = Boolean(campaign.attachedRun);
  // Launchable only when the next-pending step resolved a spec path AND a
  // project is available (the server needs both to build + run the command),
  // AND no run is already attached.
  const launchable = Boolean(next && next.specPath) && Boolean(project) && !attached;

  const doLaunch = async () => {
    if (inFlight.current || !project || !next || attached) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const result = await launchStep({ project: { id: project.id, path: project.path }, slug, stepId: next.id });
    if (result.ok) {
      setOpen(false);
      navigate(`/tasks/${result.taskId}`);
      return;
    }
    setError(errorMessage(result));
    setSubmitting(false);
    inFlight.current = false;
  };

  const onClick = () => {
    if (!launchable) return;
    // Risky next step → gate behind the confirm dialog; otherwise launch now.
    if (reason) {
      setError(null);
      setOpen(true);
      return;
    }
    void doLaunch();
  };

  const onOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setError(null);
      setSubmitting(false);
      inFlight.current = false;
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <button
        type="button"
        onClick={onClick}
        disabled={!launchable || submitting}
        data-testid={`campaign-step-launch-${slug}`}
        className="inline-flex items-center gap-1.5 rounded-[6px] border border-[var(--color-border)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-text,#111827)] transition-colors enabled:hover:bg-[var(--color-muted-bg)] disabled:cursor-not-allowed disabled:opacity-50"
        title={
          attached
            ? "A run is already attached to this campaign — launching again would spawn a second orchestrator."
            : launchable
              ? `Open a terminal running: /shipwright-iterate "${next!.specPath}"`
              : "No launchable next step (all complete, spec file missing, or no project)"
        }
      >
        <Play size={12} />
        {attached ? "Run attached" : next ? `Launch (${next.id})` : "Launch"}
      </button>

      {/* Inline (non-dialog) error for the direct-launch path. */}
      {error && !open && (
        <span
          data-testid={`campaign-step-error-${slug}`}
          className="text-[11px] text-[var(--color-error,#dc2626)]"
        >
          {error}
        </span>
      )}

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          data-testid={`campaign-step-dialog-${slug}`}
          className="fixed left-1/2 top-[14%] z-50 w-[480px] max-w-[95vw] -translate-x-1/2 overflow-hidden rounded-[var(--radius-card,12px)] bg-white shadow-[var(--shadow-modal,0_20px_60px_rgba(0,0,0,0.28))]"
        >
          <div className="flex items-center gap-3 border-b border-[var(--color-border,#e0dbd4)] px-5 py-4">
            <div
              className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px]"
              style={{ background: "#fffbeb", color: "#b45309" }}
              aria-hidden
            >
              <TriangleAlert size={18} strokeWidth={1.7} />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[15px] font-bold tracking-tight text-[var(--color-text,#1a1a1a)]">
                Launch sub-iterate {next?.id}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[12px] leading-[1.4] text-[var(--color-muted,#6b7280)]">
                This step is <strong>{reason}</strong> — review before re-running it.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="rounded-[6px] p-1 text-[var(--color-muted,#6b7280)] hover:bg-[var(--color-muted-bg,#ede8e1)] hover:text-[var(--color-text,#1a1a1a)]"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          {nextStep && (
            <div className="px-5 py-4 text-[12px] text-[var(--color-text,#111827)]">
              <span className="font-mono font-semibold">{nextStep.id}</span>{" "}
              <span className="text-[var(--color-muted)]">{nextStep.title}</span>
            </div>
          )}

          {error && (
            <div
              data-testid={`campaign-step-dialog-error-${slug}`}
              className="mx-5 mb-2 rounded-[var(--radius-button,8px)] bg-[#fee2e2] px-3 py-2 text-[12px] text-[#991b1b]"
            >
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border,#e0dbd4)] bg-[var(--color-bg,#f5f0eb)] px-5 py-3">
            <Dialog.Close asChild>
              <button
                type="button"
                data-testid={`campaign-step-cancel-${slug}`}
                className="inline-flex items-center rounded-[var(--radius-button,8px)] border-[1.5px] border-[var(--color-border,#e0dbd4)] bg-[var(--color-muted-bg,#ede8e1)] px-4 py-1.5 text-[13px] font-medium text-[var(--color-text,#1a1a1a)] hover:bg-[var(--color-border,#e0dbd4)]"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={() => void doLaunch()}
              disabled={submitting || attached}
              data-testid={`campaign-step-confirm-${slug}`}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-button,8px)] bg-[var(--color-primary,#6b5e56)] px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-[var(--color-primary-hover,#5a4f48)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play size={14} />
              {submitting ? "Launching…" : "Launch anyway"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
