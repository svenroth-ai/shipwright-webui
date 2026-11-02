/**
 * CompactionRow - "Context compacted" as a quiet system row in the Mission feed. The summary of the
 * earlier conversation stays COLLAPSED behind a "Show summary" / "Hide summary" toggle (it can be
 * thousands of words) and, once opened, renders as normal markdown. Never a human bubble. The
 * summary is only mounted while open; the row itself is always complete (no content hidden by motion).
 */
import { useId, useState } from "react";
import { MarkdownChunk } from "../BubbleTranscript/MarkdownChunk";
import type { ActivityCard } from "../../../lib/missionActivityFeed";

export function CompactionRow({ card }: { card: ActivityCard }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const summary = card.compactSummary;
  return (
    <article className="mc-compact" data-kind="system" data-testid="compaction-row">
      <div className="mc-compact-h">
        <span className="mc-compact-rule" aria-hidden="true" />
        <span className="mc-compact-t">{card.text}</span>
        {summary && (
          <button
            type="button"
            className="mc-feed-expand-btn mc-compact-toggle"
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            data-testid="compaction-toggle"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide summary" : "Show summary"}
          </button>
        )}
        <span className="mc-compact-rule" aria-hidden="true" />
      </div>
      {summary && open && (
        <div id={id} className="mc-compact-body" data-testid="compaction-summary">
          <MarkdownChunk tableWrap content={summary} />
        </div>
      )}
    </article>
  );
}
