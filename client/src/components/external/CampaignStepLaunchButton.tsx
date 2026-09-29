/*
 * CampaignStepLaunchButton — the per-campaign "Launch (Cx)" action (FR-01.36),
 * now gated by the shared confirmation dialog (FR-01.61, A17).
 *
 * EVERY launch confirms first (AC2): the click opens <CampaignLaunchDialog>
 * (what · where · the verbatim command), and only Confirm creates + launches
 * the campaign's NEXT-PENDING sub-iterate (create task → server builds the
 * command from { slug, stepId } → sessionStorage handoff → navigate → embedded
 * terminal auto-executes). The command SHOWN is a display mirror of the string
 * the SERVER builds (`launchCampaignStepRun`); the client never dictates it
 * (rule 1). A rejected launch surfaces a persistent <LaunchFailureNotice>
 * (AC3) — code-specific, Retry re-runs the SAME funnel, never a toast.
 * Disabled (never a dead button) when there is no launchable next step /
 * project, or when a run is already attached.
 */

import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play } from "lucide-react";

import type { Campaign } from "../../lib/campaignsApi";
import type { Project } from "../../types";
import { useLaunchCampaignStep } from "../../hooks/useLaunchCampaignStep";
import { launchResultFailure, type LaunchFailure } from "../../lib/launchFailure";
import { CampaignLaunchDialog } from "./CampaignLaunchDialog";
import { LaunchFailureNotice } from "./LaunchFailureNotice";

export function CampaignStepLaunchButton({
  campaign,
  project,
  stepId,
  compact = false,
  notice = null,
}: {
  campaign: Campaign;
  project: Project | null | undefined;
  /** Launch THIS step instead of the campaign's next-pending one (the DAG view's
   *  per-unit control — only rendered for a unit the scheduler reports ready). */
  stepId?: string;
  /** Small in-list variant (label "Launch"; the step id is already on the row). */
  compact?: boolean;
  /** Shown in the confirm dialog when the launch is not verified against the
   *  scheduler's dependency graph (fail-open must never be silent). */
  notice?: string | null;
}) {
  const navigate = useNavigate();
  const launchStep = useLaunchCampaignStep();

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<LaunchFailure | null>(null);
  const inFlight = useRef(false);

  const slug = campaign.slug;
  // Default = the campaign's next-pending step, taken from `nextPending` itself
  // (id + specPath) even if it is absent from `steps`; `stepId` = the DAG view's
  // per-unit control, resolved from the step list.
  const explicit = stepId ? campaign.steps.find((s) => s.id === stepId) : undefined;
  const next = stepId
    ? explicit
      ? { id: explicit.id, specPath: explicit.specPath }
      : null
    : campaign.nextPending;
  const nextStep = next ? campaign.steps.find((s) => s.id === next.id) : undefined;
  const attached = Boolean(campaign.attachedRun);
  const launchable = Boolean(next && next.specPath) && Boolean(project) && !attached;

  const specPath = next?.specPath ?? "";
  // Display mirror of the command the SERVER builds (`launchCampaignStepRun`).
  const command = `/shipwright-iterate "${specPath}"`;
  const projectName = project?.name ?? project?.id ?? "—";

  const doLaunch = async () => {
    if (inFlight.current || !project || !next || attached) return;
    inFlight.current = true;
    setSubmitting(true);
    setFailure(null);
    const result = await launchStep({ project: { id: project.id, path: project.path }, slug, stepId: next.id });
    if (result.ok) {
      setOpen(false);
      navigate(`/tasks/${result.taskId}`);
      return;
    }
    setFailure(launchResultFailure(result.reason, result.detail));
    setSubmitting(false);
    inFlight.current = false;
  };

  const onOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    // Opening fresh clears the last failure; closing KEEPS it so the card's
    // inline failure row persists (AC3 — never a failure that evaporates).
    if (nextOpen) {
      setFailure(null);
      setSubmitting(false);
      inFlight.current = false;
    }
  };

  const copyCommand = () => void navigator.clipboard?.writeText(command);

  return (
    <>
      <button
        type="button"
        onClick={() => launchable && setOpen(true)}
        disabled={!launchable || submitting}
        data-testid={stepId ? `campaign-step-launch-${slug}-${stepId}` : `campaign-step-launch-${slug}`}
        className={(compact ? "px-2 py-0.5 text-[11px] " : "px-2.5 py-1 text-[12px] ") + "inline-flex shrink-0 items-center gap-1.5 rounded-[6px] border border-[var(--color-border)] font-medium text-[var(--color-text,#111827)] transition-colors enabled:hover:bg-[var(--color-muted-bg)] disabled:cursor-not-allowed disabled:opacity-50"}
        title={
          attached
            ? "A run is already attached to this campaign — launching again would spawn a second orchestrator."
            : launchable
              ? "Review and launch the next sub-iterate in a terminal"
              : "No launchable next step (all complete, spec file missing, or no project)"
        }
      >
        <Play size={12} />
        {attached ? "Run attached" : compact ? "Launch" : next ? `Launch (${next.id})` : "Launch"}
      </button>

      <CampaignLaunchDialog
        open={open}
        onOpenChange={onOpenChange}
        slug={slug}
        testIdPrefix="campaign-step"
        variant="step"
        title={`Launch sub-iterate ${next?.id ?? ""}`}
        command={command}
        what={{ stepId: next?.id, stepTitle: nextStep?.title, specPath }}
        where={{ projectName, cwd: project?.path ?? "" }}
        submitting={submitting}
        confirmLabel="Launch"
        notice={notice}
        failure={failure}
        onConfirm={() => void doLaunch()}
        onRetry={() => void doLaunch()}
        onCopyCommand={copyCommand}
      />

      {/* Persistent card failure row after the dialog is dismissed (AC3). */}
      {failure && !open && (
        <LaunchFailureNotice
          testId={`campaign-step-failure-${slug}`}
          failure={failure}
          busy={submitting}
          actions={{
            retry: { onClick: () => void doLaunch() },
            "copy-command": { onClick: copyCommand },
          }}
        />
      )}
    </>
  );
}
