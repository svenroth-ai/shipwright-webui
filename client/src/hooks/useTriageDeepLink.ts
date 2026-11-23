/*
 * useTriageDeepLink — `/triage?project=<projectId>&item=<triageId>` opens that
 * one entry's detail dialog (reminders-webui follow-up: "Open in Triage" on an
 * expired parked item used to land on the general list).
 *
 * Triage ids can repeat across projects, so BOTH values are needed and the
 * match is on the (project, id) pair. The link is consumed once: after the
 * dialog opens (or the entry is known to be gone) the query is removed, so
 * closing the dialog, a reload or Back never re-opens it. While the lists are
 * still loading nothing happens; a stale link that matches nothing just leaves
 * the user on the normal list.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { TriageEntry } from "../lib/triageFilterSort";

export function triageDeepLink(projectId: string, itemId: string | null): string {
  if (!itemId) return "/triage";
  return `/triage?project=${encodeURIComponent(projectId)}&item=${encodeURIComponent(itemId)}`;
}

export function useTriageDeepLink(
  entries: readonly TriageEntry[],
  /** True once every project's list has answered (so "not found" is final). */
  settled: boolean,
  open: (entry: TriageEntry) => void,
): void {
  const [params, setParams] = useSearchParams();
  const project = params.get("project");
  const item = params.get("item");

  useEffect(() => {
    if (!project || !item) return;
    const hit = entries.find((e) => e.projectId === project && e.item.id === item);
    if (!hit && !settled) return; // still loading: try again when the lists arrive
    if (hit) open(hit);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("project");
        next.delete("item");
        return next;
      },
      { replace: true },
    );
  }, [project, item, entries, settled, open, setParams]);
}

/**
 * The Triage page's selected entry (the open detail dialog), with the deep link wired in.
 * "Settled" = the project list and every project's triage list have answered, so a link
 * that matches nothing is final (an empty project list counts as settled).
 */
export function useTriageSelection(
  entries: readonly TriageEntry[],
  statuses: readonly { isLoading: boolean }[],
  projectsLoaded: boolean,
) {
  const [selected, setSelected] = useState<TriageEntry | null>(null);
  useTriageDeepLink(entries, projectsLoaded && statuses.every((s) => !s.isLoading), setSelected);
  return [selected, setSelected] as const;
}
