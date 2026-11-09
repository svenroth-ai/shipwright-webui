/*
 * TriagePills — the one pill row shared by the Triage card and the detail
 * dialog (iterate-2026-11-09-triage-polish-r3), so both show the same colours
 * and words. Only what helps a reader decide: where it came from (with its
 * "?"), how serious it is (no "?" — low / medium / high explain themselves),
 * and the rare state flags. The project pill is solid dark-on-light with a
 * colour dot, so it stays readable on any scene.
 */

import type { TriageItem } from "../../lib/triageApi";
import { getProjectColor } from "../../lib/projectColor";
import { sourceHelp } from "../../lib/triageHelpText";
import { PendingDeliveryBadge, ReturnedBadge, SeverityBadge, SourceBadge } from "./TriageBadgeUI";
import { TriageHelp } from "./TriageHelp";

interface Props {
  item: TriageItem;
  projectId: string;
  /** Only passed when the list mixes several projects. */
  projectLabel?: string;
  /** Hide the severity pill while the title/severity form is open. */
  hideSeverity?: boolean;
}

export function TriagePills({ item, projectId, projectLabel, hideSeverity = false }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5" data-testid={`triage-pills-${item.id}`}>
      <SourceBadge source={item.source} />
      <TriageHelp help={sourceHelp(item.source, item.title, item.detail)} subject={`source-${item.source}`} />
      {!hideSeverity && <SeverityBadge severity={item.severity} />}
      {item.pendingDelivery && <PendingDeliveryBadge />}
      {item.revisitDue && <ReturnedBadge />}
      {projectLabel && (
        <span
          className="inline-flex items-center gap-1.5 rounded border border-[var(--color-border)] bg-[var(--color-muted-bg)] px-2 py-0.5 text-xs font-medium text-[var(--color-text)]"
          data-testid={`triage-item-${item.id}-project`}
        >
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: getProjectColor(projectId).hsl }}
          />
          {projectLabel}
        </span>
      )}
    </div>
  );
}
