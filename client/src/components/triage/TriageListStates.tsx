/*
 * TriageListStates — the two "nothing to show" messages of the Triage page
 * (iterate-2026-11-08-triage-page-redesign): the genuine all-clear and the
 * "filtered out" line with its Clear action. Extracted from TriagePage to keep
 * that file under its bloat ceiling.
 *
 * "All clear" only when nothing is open, no parked card is on screen, no
 * attribute filter hides a parked item and no project failed to load.
 * "Filtered out" only when open (or filter-hidden parked) items exist but are
 * all narrowed away — never when only Show-parked-off items remain.
 */

import type { TriageProjectStatus } from "../../hooks/useTriage";
import type { BoardModel } from "../../lib/triageBoardModel";

interface Props {
  model: BoardModel;
  statuses: readonly TriageProjectStatus[];
  showParked: boolean;
  onClear: () => void;
}

export function TriageListStates({ model, statuses, showParked, onClear }: Props) {
  const loaded = statuses.every((s) => !s.isLoading);
  const anyError = statuses.some((s) => s.isError);
  const nothingShown = model.visibleOpen.length === 0 && model.visibleParked.length === 0;
  // Parked items the attribute filters excluded (not merely the Show-parked switch).
  const switchHidden = showParked
    ? 0
    : model.parkedAll.filter((e) => e.item.revisitAt && !e.item.revisitDue).length;
  const parkedFiltered = Math.max(0, model.hiddenParked - switchHidden);
  const showEmpty =
    loaded && !anyError && model.openAll.length === 0 && model.visibleParked.length === 0 && parkedFiltered === 0;
  const showFilteredOut = loaded && nothingShown && (model.openAll.length > 0 || parkedFiltered > 0);
  // Parked items hidden only by the Show-parked switch have their own hint.
  const hiddenTotal = model.openAll.length - model.visibleOpen.length + (showParked ? model.hiddenParked : 0);

  return (
    <>
      {showEmpty && (
        <p className="py-8 text-center text-sm text-[var(--muted)]" data-testid="triage-empty-state">
          No triage items pending. ✓
        </p>
      )}
      {showFilteredOut && (
        <p className="py-8 text-center text-sm text-[var(--muted)]" data-testid="triage-all-filtered-out">
          {hiddenTotal > 0 ? `${hiddenTotal} hidden by the current view` : "Nothing matches"} —{" "}
          <button
            type="button"
            onClick={onClear}
            className="underline hover:text-[var(--ink)]"
            data-testid="triage-all-filtered-out-clear"
          >
            clear filters
          </button>{" "}
          to see them.
        </p>
      )}
    </>
  );
}
