/*
 * CampaignAutonomousLaunchButton — the SECOND Campaigns-lane action (FR-01.34),
 * now routed through the shared confirmation dialog (FR-01.61, A17).
 *
 * Opens <CampaignLaunchDialog> (variant "autonomous"): what · where · the
 * verbatim command · the remaining sub-iterates BY NAME · a plain statement
 * that it will NOT ask again (it runs every remaining pending sub-iterate in
 * order, unattended). A risky pending step (previously failed/escalated, or
 * plan-first) still gates Confirm behind an explicit ack. The command is a
 * display mirror of the string the SERVER builds (`launchCampaignRun`); the
 * client never dictates it (rule 1). A rejected launch surfaces a persistent
 * <LaunchFailureNotice> (AC3), never a toast. Disabled (never dead) when there
 * is nothing pending / no project, or a run is already attached.
 */

import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot } from "lucide-react";

import type { Campaign } from "../../lib/campaignsApi";
import { selectRiskyPendingSteps } from "../../lib/campaignsApi";
import type { Project } from "../../types";
import { useLaunchCampaign } from "../../hooks/useLaunchCampaign";
import { launchResultFailure, type LaunchFailure } from "../../lib/launchFailure";
import { CampaignLaunchDialog } from "./CampaignLaunchDialog";
import { LaunchFailureNotice } from "./LaunchFailureNotice";

export function CampaignAutonomousLaunchButton({
  campaign,
  project,
}: {
  campaign: Campaign;
  project: Project | null | undefined;
}) {
  const navigate = useNavigate();
  const launchCampaign = useLaunchCampaign();

  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<LaunchFailure | null>(null);
  const inFlight = useRef(false);

  const slug = campaign.slug;
  // Display mirror of the command the SERVER builds (`launchCampaignRun`).
  const command = `/shipwright-iterate --campaign ${slug} --autonomous`;
  const risky = useMemo(() => selectRiskyPendingSteps(campaign), [campaign]);
  const remaining = useMemo(() => campaign.steps.filter((s) => s.status !== "complete"), [campaign]);
  const hasPending = campaign.done < campaign.total;
  const attached = Boolean(campaign.attachedRun);
  const canLaunch = Boolean(project) && hasPending && !attached;
  const projectName = project?.name ?? project?.id ?? "—";

  const onOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setAck(false);
      setFailure(null);
      setSubmitting(false);
      inFlight.current = false;
    }
  };

  const onConfirm = async () => {
    if (inFlight.current || !project || attached) return;
    // Defense-in-depth: the risky ack is a real gate, not presentation-only.
    if (risky.length > 0 && !ack) return;
    inFlight.current = true;
    setSubmitting(true);
    setFailure(null);
    const result = await launchCampaign({ project: { id: project.id, path: project.path }, slug });
    if (result.ok) {
      setOpen(false);
      navigate(`/tasks/${result.taskId}`);
      return;
    }
    setFailure(launchResultFailure(result.reason, result.detail));
    setSubmitting(false);
    inFlight.current = false;
  };

  const copyCommand = () => void navigator.clipboard?.writeText(command);

  return (
    <>
      <button
        type="button"
        onClick={() => canLaunch && setOpen(true)}
        disabled={!canLaunch}
        data-testid={`campaign-autonomous-launch-${slug}`}
        className="inline-flex items-center gap-1.5 rounded-[6px] border border-[var(--color-border)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-text,#111827)] transition-colors enabled:hover:bg-[var(--color-muted-bg)] disabled:cursor-not-allowed disabled:opacity-50"
        title={
          attached
            ? "A run is already attached to this campaign — launching again would spawn a second orchestrator."
            : canLaunch
              ? "Review and launch every remaining sub-iterate, unattended"
              : "No pending sub-iterate to run (or no project resolved)"
        }
      >
        <Bot size={12} />
        {attached ? "Run attached" : "Launch autonomous"}
      </button>

      <CampaignLaunchDialog
        open={open}
        onOpenChange={onOpenChange}
        slug={slug}
        testIdPrefix="campaign-autonomous"
        variant="autonomous"
        title="Launch autonomous campaign"
        command={command}
        what={{ stepTitle: slug }}
        where={{ projectName, cwd: project?.path ?? "" }}
        remaining={remaining}
        risky={risky}
        ack={ack}
        onAckChange={setAck}
        submitting={submitting}
        confirmDisabled={risky.length > 0 && !ack}
        confirmLabel="Launch autonomous"
        failure={failure}
        onConfirm={() => void onConfirm()}
        onRetry={() => void onConfirm()}
        onCopyCommand={copyCommand}
      />

      {failure && !open && (
        <LaunchFailureNotice
          testId={`campaign-autonomous-failure-${slug}`}
          failure={failure}
          busy={submitting}
          actions={{
            retry: { onClick: () => void onConfirm() },
            "copy-command": { onClick: copyCommand },
          }}
        />
      )}
    </>
  );
}
