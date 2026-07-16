/*
 * MissionMetaLine — the desktop meta sub-line of Mission Control's top row
 * (extracted from MissionTopRow to hold both under their footprint caps, A13).
 *
 * The phase chip (server-persisted phase preferred over the title regex) + the
 * "Started … · last event …" line + the model label. Rendered ONLY on desktop
 * (MissionTopRow drops it on a phone for terminal headroom); everything here
 * stays reachable elsewhere (project via the chip, session metadata via ⋯).
 */

import { useMemo } from "react";

import type { ExternalTask } from "../../../lib/externalApi";
import { formatRelativeTime } from "../../../lib/formatTime";
import { getPhaseStyle, resolveTaskPhase } from "../../../lib/phaseStyle";

interface Props {
  task: ExternalTask;
  startedAt: string;
  lastEventAt?: string;
  modelName?: string | null;
}

export function MissionMetaLine({ task, startedAt, lastEventAt, modelName }: Props) {
  const phase = useMemo(() => {
    const resolved = resolveTaskPhase(task);
    if (!resolved) return null;
    const style = getPhaseStyle(resolved.id);
    return { label: resolved.label, cls: style.cls, dot: style.dot };
  }, [task]);

  return (
    <div
      className="flex flex-wrap items-center gap-2.5 font-mono text-[11px] text-[var(--color-muted,#6b7280)]"
      data-testid="task-detail-subline"
    >
      {phase && (
        <>
          <span className={`inline-flex items-center gap-1.5 rounded-[10px] px-2 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-[0.04em] ${phase.cls}`}>
            <span className={`inline-block h-[5px] w-[5px] rounded-full ${phase.dot}`} />
            {phase.label}
          </span>
          <span aria-hidden="true" className="inline-block h-[10px] w-px bg-[var(--color-border,#e0dbd4)]" />
        </>
      )}
      <span>
        Started {formatRelativeTime(startedAt)}
        {lastEventAt ? ` · last event ${formatRelativeTime(lastEventAt)}` : ""}
      </span>
      {modelName && (
        <>
          <span aria-hidden="true" className="inline-block h-[10px] w-px bg-[var(--color-border,#e0dbd4)]" />
          <span className="font-mono text-[11px]">{modelName}</span>
        </>
      )}
    </div>
  );
}
