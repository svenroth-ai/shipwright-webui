/*
 * CampaignStartButton — the board's Start-Campaign affordance (FR-01.61, A17).
 *
 * A `draft` campaign lived only in Triage before this: the board rendered it
 * identically to an active one and offered no way to start it. This CTA wires
 * the board to the EXISTING `useStartCampaign()` → `POST …/start` (the SAME
 * single WebUI campaign-state write the triage modal uses — no second code
 * path). A refused start (403 / 404 / 409 / 422 / 503) is surfaced as a
 * persistent inline `<LaunchFailureNotice>`, code-specific, never a toast (AC3).
 */

import { useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";

import type { Campaign } from "../../lib/campaignsApi";
import type { Project } from "../../types";
import { useStartCampaign } from "../../hooks/useStartCampaign";
import { campaignsKey } from "../../hooks/useCampaigns";
import { resolveLaunchFailure } from "../../lib/launchFailure";
import { LaunchFailureNotice } from "./LaunchFailureNotice";

export function CampaignStartButton({
  campaign,
  project,
}: {
  campaign: Campaign;
  project: Project | null | undefined;
}) {
  const projectId = project?.id ?? "";
  const qc = useQueryClient();
  const start = useStartCampaign(projectId);

  const outcome = start.data;
  const failure =
    outcome && !outcome.ok ? resolveLaunchFailure({ source: "server", code: outcome.error }) : null;

  const doStart = () => {
    if (!projectId || start.isPending) return;
    start.mutate(campaign.slug);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={doStart}
        disabled={!projectId || start.isPending}
        data-testid={`campaign-start-${campaign.slug}`}
        className="inline-flex items-center gap-1.5 rounded-[6px] bg-[var(--color-primary,#6b5e56)] px-2.5 py-1 text-[12px] font-semibold text-white transition-colors enabled:hover:bg-[var(--color-primary-hover,#5a4f48)] disabled:cursor-not-allowed disabled:opacity-50"
        title={projectId ? "Set this campaign active so its steps can be launched" : "No project resolved"}
      >
        <Play size={12} />
        {start.isPending ? "Starting…" : "Start campaign"}
      </button>

      {failure && (
        <LaunchFailureNotice
          testId={`campaign-start-failure-${campaign.slug}`}
          failure={failure}
          busy={start.isPending}
          actions={{
            retry: { onClick: doStart },
            refresh: {
              onClick: () => void qc.invalidateQueries({ queryKey: campaignsKey(projectId) }),
            },
            "open-project-settings": { href: "/projects" },
          }}
        />
      )}
    </div>
  );
}
