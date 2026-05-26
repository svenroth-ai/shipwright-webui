/*
 * PlainBubbles — Campaign-C C3 BubbleTranscript split (2026-05-26).
 *
 * Non-virtualized event list renderer. Used when the visible event count
 * is below `VIRTUALIZE_THRESHOLD` (200). Packs consecutive `attachment`
 * events into a single flex-wrap `AttachmentStrip` (mockup FR-03.53).
 *
 * Extracted bit-perfect from the legacy `BubbleTranscript.tsx`.
 */

import { useMemo, type ReactNode } from "react";

import type { ParsedEvent } from "../../../external/session-parser";
import { TranscriptRow } from "./TranscriptRow";
import { renderAttachmentCard } from "./BubblePills";
import { stableEventKey } from "./filters";
import type { ExternalTask } from "../../../lib/externalApi";

type BubbleGroup =
  | { kind: "single"; event: ParsedEvent; baseIndex: number }
  | { kind: "attachments"; events: ParsedEvent[]; baseIndex: number };

function groupConsecutiveAttachments(events: ParsedEvent[]): BubbleGroup[] {
  const out: BubbleGroup[] = [];
  let i = 0;
  while (i < events.length) {
    const e = events[i];
    if (e.kind === "attachment") {
      const start = i;
      const bucket: ParsedEvent[] = [];
      while (i < events.length && events[i].kind === "attachment") {
        bucket.push(events[i]);
        i += 1;
      }
      out.push({ kind: "attachments", events: bucket, baseIndex: start });
    } else {
      out.push({ kind: "single", event: e, baseIndex: i });
      i += 1;
    }
  }
  return out;
}

function AttachmentStrip({
  events,
  indexBase,
}: {
  events: ParsedEvent[];
  indexBase: number;
}): ReactNode {
  return (
    <div
      className="flex flex-wrap items-start justify-start"
      style={{ gap: "8px" }}
      data-testid="bubble-attachment-strip"
    >
      {events.map((e, i) => (
        <div key={`${indexBase}-${i}`} data-testid="bubble-attachment">
          {renderAttachmentCard(e)}
        </div>
      ))}
    </div>
  );
}

export function PlainBubbles({
  events,
  resolved,
  toolResultsById,
  visibleToolUseIds,
  allToolUses,
  task,
}: {
  events: ParsedEvent[];
  resolved: Set<string>;
  toolResultsById: Map<string, { content: string; is_error: boolean }>;
  visibleToolUseIds: Set<string>;
  allToolUses: { id: string; name: string; input: unknown }[];
  task?: ExternalTask;
}) {
  // Pack consecutive attachments into a single flex-wrap row so chips
  // render side-by-side (mockup FR-03.53 visual grouping).
  const groups = useMemo(() => groupConsecutiveAttachments(events), [events]);

  return (
    <div
      className="flex flex-col"
      style={{ gap: "14px", padding: "20px 40px 80px" }}
      data-testid="bubble-list-plain"
    >
      {groups.map((group, gi) => {
        if (group.kind === "attachments") {
          return (
            <AttachmentStrip
              key={`att-${gi}`}
              events={group.events}
              indexBase={group.baseIndex}
            />
          );
        }
        const e = group.event;
        const i = group.baseIndex;
        const previous = i > 0 ? events[i - 1] : null;
        const isLatest = i === events.length - 1;
        return (
          <TranscriptRow
            key={stableEventKey(e, i)}
            entry={e}
            isLatest={isLatest}
            previous={previous}
            resolved={resolved}
            toolResultsById={toolResultsById}
            visibleToolUseIds={visibleToolUseIds}
            allToolUses={allToolUses}
            task={task}
          />
        );
      })}
    </div>
  );
}
