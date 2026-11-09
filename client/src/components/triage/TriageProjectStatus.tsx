/*
 * TriageProjectStatus — per-project notices above the list
 * (iterate-2026-11-08-triage-page-redesign): the "checkout is N commits
 * behind origin" banner, a loading line and a load-error block with Retry.
 * These used to live inside the per-project sections; the page is now one
 * aggregated list, so a failed or stale project is still named here instead
 * of silently contributing zero items.
 */

import type { TriageProjectStatus as Status } from "../../hooks/useTriage";
import { ListLoadErrorState } from "../common/ListLoadErrorState";

interface Props {
  statuses: readonly Status[];
  nameOf: (projectId: string) => string;
  /** Show the project name in each notice (several projects in scope). */
  named: boolean;
}

export function TriageProjectStatus({ statuses, nameOf, named }: Props) {
  return (
    <>
      {statuses.map((s) => {
        const prefix = named ? `${nameOf(s.projectId)}: ` : "";
        if (s.isError) {
          return (
            <div key={s.projectId} className="mb-3">
              {named && <p className="mb-1 text-xs text-[var(--ink)]">{nameOf(s.projectId)}</p>}
              <ListLoadErrorState
                testId={`triage-load-error-${s.projectId}`}
                label="triage items"
                onRetry={s.refetch}
              />
            </div>
          );
        }
        if (s.isLoading) {
          return (
            <p
              key={s.projectId}
              className="mb-2 text-sm text-[var(--muted)]"
              data-testid={`triage-loading-${s.projectId}`}
            >
              {prefix}Loading…
            </p>
          );
        }
        if (s.behind != null && s.behind > 0) {
          return (
            <div
              key={s.projectId}
              role="status"
              data-testid={`triage-stale-banner-${s.projectId}`}
              className="mb-3 rounded-md border border-[var(--warn-line)] bg-warn-tint px-3 py-2 text-xs text-warn"
            >
              {prefix}Local checkout is {s.behind} commit{s.behind === 1 ? "" : "s"} behind origin —{" "}
              <code>git pull</code> to sync.
              {s.originAvailable ? "" : " Origin is unavailable, so already-dismissed items may still appear here."}
            </div>
          );
        }
        return null;
      })}
    </>
  );
}
