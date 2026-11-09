/*
 * triageTaskLinks.ts — which triage item already has a Fix-now task
 * (iterate-2026-11-09-triage-fixnow-task). Triage ids are only unique per
 * project, so a link is keyed `projectId:triageId` — the same key as
 * `entryKey`. A done task or one whose launch failed releases its item (Fix now
 * is offered again); with several live tasks for one item the newest wins.
 */

import type { ExternalTask } from "./externalApi";

export function taskLinkKey(projectId: string, triageId: string): string {
  return `${projectId}:${triageId}`;
}

export function buildTaskLinks(tasks: readonly ExternalTask[]): Map<string, ExternalTask> {
  const links = new Map<string, ExternalTask>();
  for (const t of tasks) {
    if (!t.fixNowForTriageId || t.state === "done" || t.state === "launch_failed") continue;
    const key = taskLinkKey(t.projectId, t.fixNowForTriageId);
    const seen = links.get(key);
    if (!seen || Date.parse(t.createdAt) > Date.parse(seen.createdAt)) links.set(key, t);
  }
  return links;
}
