/*
 * TriageProjectStatus — per-project notices in the summary row above the list
 * (iterate-2026-11-08-triage-page-redesign): the "checkout is N commits
 * behind origin" chip, a loading line and a load-error block with Retry.
 * These used to live inside the per-project sections; the page is now one
 * aggregated list, so a failed or stale project is still named here instead
 * of silently contributing zero items. The behind-origin notice is a compact,
 * NON-clickable chip with square-ish corners so it never reads as one of the
 * round filter pills next to it (iterate-2026-11-13-triage-rows-round3).
 */

import { ArrowDownToLine } from "lucide-react";

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
            <div key={s.projectId} className="basis-full">
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
              className="m-0 basis-full text-sm text-[var(--muted)]"
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
              className="inline-flex min-h-8 max-w-full items-center gap-2 rounded-lg border border-[var(--warn-solid,var(--warn))] bg-[var(--triage-lane-solid)] px-3 py-1 text-[13px] text-white/90"
            >
              <ArrowDownToLine size={14} aria-hidden="true" className="shrink-0 text-[var(--warn-solid,var(--warn))]" />
              <span className="min-w-0">
                {named && <b className="font-semibold text-white">{nameOf(s.projectId)}: </b>}
                Local checkout is {s.behind} commit{s.behind === 1 ? "" : "s"} behind origin
                {s.originAvailable ? "" : " — origin is unavailable, so already-dismissed items may still appear here"}
              </span>
              <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-white/25" />
              <code className="shrink-0 rounded bg-white/15 px-1.5 py-px font-mono text-xs text-white">git pull</code>
            </div>
          );
        }
        return null;
      })}
    </>
  );
}
