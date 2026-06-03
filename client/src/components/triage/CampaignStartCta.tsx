/*
 * CampaignStartCta.tsx — presentational CTA block for a campaign-umbrella
 * triage item (FR-01.33). Rendered by TriageDetailModal when the item carries
 * a `campaignSlug`. Pure view: the parent owns the start mutation, navigation,
 * pending + error state, and passes them in. Imports NO campaign module, so
 * the campaigns-no-triage-coupling guard is satisfied by construction.
 *
 *   draft / null → "Start Campaign" (calls onStart → flip draft→active)
 *   active       → "Go to board"    (calls onGoToBoard — no status write)
 *   complete     → static "nothing to start" note (no button)
 */

import { Loader2 } from "lucide-react";

const PRIMARY_BTN =
  "h-10 px-5 text-sm font-medium rounded-[var(--radius-button)] bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5";

interface CampaignStartCtaProps {
  slug: string;
  status: "draft" | "active" | "complete" | null;
  isStarting: boolean;
  error: string | null;
  onStart: () => void;
  onGoToBoard: () => void;
}

export function CampaignStartCta({
  slug,
  status,
  isStarting,
  error,
  onStart,
  onGoToBoard,
}: CampaignStartCtaProps) {
  return (
    <div
      className="border-t border-stone-200 pt-4 mt-4"
      data-testid="triage-campaign-cta"
    >
      <h4 className="text-xs font-semibold text-stone-700 uppercase mb-2">
        Campaign
      </h4>
      <p className="text-xs text-stone-600 mb-3">
        This item is the umbrella for campaign{" "}
        <code className="text-[11px]">{slug}</code>
        {status ? ` (${status})` : ""}.
      </p>
      {status === "complete" ? (
        <p className="text-xs text-stone-500" data-testid="triage-campaign-complete">
          Campaign complete — nothing to start.
        </p>
      ) : status === "active" ? (
        <button
          type="button"
          onClick={onGoToBoard}
          className={PRIMARY_BTN}
          data-testid="triage-go-to-board"
        >
          Go to board →
        </button>
      ) : (
        <button
          type="button"
          onClick={onStart}
          disabled={isStarting}
          className={PRIMARY_BTN}
          data-testid="triage-start-campaign"
        >
          {isStarting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Start Campaign →
        </button>
      )}
      {error && (
        <div
          className="mt-3 p-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded"
          data-testid="triage-start-campaign-error"
        >
          {error}
        </div>
      )}
    </div>
  );
}
