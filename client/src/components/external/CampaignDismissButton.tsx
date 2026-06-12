/*
 * CampaignDismissButton — the per-card board-quittance control (iterate-2026-06-12).
 * A quiet icon button in the CampaignLaneCard header:
 *   - not dismissed → EyeOff ("Als erledigt markieren" — hide from the board)
 *   - dismissed     → RotateCcw ("Wiederherstellen" — back onto the board)
 * Toggles webui-owned state via `useDismissCampaign` (NOT a producer status).
 * Renders nothing without a resolved project (the action is keyed by projectId).
 */

import { EyeOff, RotateCcw, Loader2 } from "lucide-react";

import type { Campaign } from "../../lib/campaignsApi";
import type { Project } from "../../types";
import { useDismissCampaign } from "../../hooks/useDismissCampaign";

export function CampaignDismissButton({
  campaign,
  project,
}: {
  campaign: Campaign;
  project?: Project | null;
}) {
  const mutation = useDismissCampaign(project?.id ?? "");
  if (!project?.id) return null; // can't key the action without a project

  const dismissed = Boolean(campaign.dismissed);
  const label = dismissed
    ? `Wiederherstellen — Kampagne ${campaign.slug} zurück auf das Board`
    : `Als erledigt markieren — Kampagne ${campaign.slug} vom Board ausblenden`;

  return (
    <button
      type="button"
      onClick={() => mutation.mutate({ slug: campaign.slug, dismissed })}
      disabled={mutation.isPending}
      data-testid={`campaign-dismiss-${campaign.slug}`}
      data-dismissed={dismissed || undefined}
      title={label}
      aria-label={label}
      className="inline-flex shrink-0 items-center justify-center rounded-[6px] p-1 text-[var(--color-muted)] transition hover:bg-[var(--color-muted-bg)] hover:text-[var(--color-text,#111827)] disabled:opacity-50"
    >
      {mutation.isPending ? (
        <Loader2 size={13} className="animate-spin" aria-hidden="true" />
      ) : dismissed ? (
        <RotateCcw size={13} aria-hidden="true" />
      ) : (
        <EyeOff size={13} aria-hidden="true" />
      )}
    </button>
  );
}
