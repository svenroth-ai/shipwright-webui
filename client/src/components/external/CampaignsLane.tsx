/*
 * CampaignsLane — the Task Board's Campaigns lane (FR-01.31/33). Extracted
 * verbatim from TaskBoardPage (which kept the lane inline) so the dismiss
 * affordance (iterate-2026-06-12) has a home without growing the grandfathered
 * TaskBoardPage file.
 *
 * Renders the active lane (`selectVisibleCampaigns` — would-be-visible minus
 * dismissed) plus a quiet "N erledigt · anzeigen" toggle that reveals the
 * dismissed list (`selectDismissedCampaigns`) with each card offering Restore.
 * Lane is hidden entirely (no wrapper, no layout shift) only when there is
 * nothing to show AND nothing dismissed.
 */

import { useMemo, useState } from "react";

import { useCampaigns } from "../../hooks/useCampaigns";
import {
  selectVisibleCampaigns,
  selectDismissedCampaigns,
  selectDraftCampaigns,
} from "../../lib/campaignsApi";
import type { Project } from "../../types";
import { CampaignLaneCard } from "./CampaignLaneCard";

export function CampaignsLane({
  projectId,
  project,
}: {
  /** Resolved active project id; null/undefined → the hook returns []. */
  projectId: string | null | undefined;
  /** Resolved active project (create-task cwd + projectId for the card actions). */
  project?: Project | null;
}) {
  const campaignsQuery = useCampaigns(projectId);
  const data = campaignsQuery.data ?? [];
  const drafts = useMemo(() => selectDraftCampaigns(data), [data]);
  const visible = useMemo(() => selectVisibleCampaigns(data), [data]);
  const dismissed = useMemo(() => selectDismissedCampaigns(data), [data]);
  const [showDismissed, setShowDismissed] = useState(false);

  if (drafts.length === 0 && visible.length === 0 && dismissed.length === 0) return null;

  return (
    <div
      className="page-container flex w-full flex-col gap-2 pt-6 pb-2"
      data-testid="task-board-campaigns-lane"
    >
      {/* on-photo-legibility fix: the CAMPAIGNS rail label rides bare on the
          deck-golden photo (below the 300px scrim band), so it must use the
          Weather-Deck `--muted` token that flips WHITE under `.on-photo`
          (prototype `.orch .sec-h{color:var(--muted)}`), NOT the legacy
          `--color-muted` alias (computed at :root, stays dark → invisible). */}
      <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
        Campaigns
      </div>
      <div
        className="flex max-h-[40vh] flex-col gap-3 overflow-y-auto [&>*]:shrink-0"
        data-testid="task-board-campaigns-scroll"
      >
        {drafts.map((c) => (
          <CampaignLaneCard key={c.slug} campaign={c} project={project} />
        ))}
        {visible.map((c) => (
          <CampaignLaneCard key={c.slug} campaign={c} project={project} />
        ))}

        {dismissed.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowDismissed((v) => !v)}
              aria-expanded={showDismissed}
              data-testid="campaigns-show-dismissed-toggle"
              className="self-start text-[11px] font-medium text-[var(--muted)] transition hover:text-[var(--ink)] hover:underline"
            >
              {showDismissed
                ? "Erledigte ausblenden"
                : `${dismissed.length} erledigt · anzeigen`}
            </button>
            {showDismissed && (
              <div
                className="flex flex-col gap-3 opacity-60"
                data-testid="task-board-campaigns-dismissed"
              >
                {dismissed.map((c) => (
                  <CampaignLaneCard key={c.slug} campaign={c} project={project} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
