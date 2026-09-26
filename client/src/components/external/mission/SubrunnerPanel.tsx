/*
 * SubrunnerPanel — the RIGHT panel a resolved `subrunner` card opens
 * (iterate-2026-09-26-mission-tab-subrunner). Third consumer of
 * `MissionBody`'s existing `activeNode`/right-panel mechanic (alongside
 * `ArtifactPanel`/`MissionArtifactPanel`) — reuses the same `.artifact`/
 * `.a-scrim`/`.a-close`/`.eyebrow` chrome, no new CSS recipe.
 *
 * v1 shows the dispatch description + the subagent's final report only —
 * there is no durable way to show live step-by-step subagent activity today
 * (confirmed empirically: a real just-completed dispatch's own scratch
 * output file was empty).
 *
 * a11y: same contract as the sibling panels — role=dialog, Esc closes, focus
 * returns to the node that opened it.
 */

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import type { ActivityCard } from "../../../lib/missionActivityFeed";
import { MarkdownChunk } from "../BubbleTranscript/MarkdownChunk";

interface Props {
  card: ActivityCard;
  onClose: () => void;
}

export function SubrunnerPanel({ card, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnToRef = useRef<HTMLElement | null>(null);

  // Captures the opener once, on mount — NOT keyed on `card.subrunnerId`
  // (external code review, low): the reducer overwrites a subrunner card's
  // provisional id with its real agent id mid-lifecycle, which would re-run
  // this effect while the panel is still open and clobber the return target
  // with the panel's own close button (`document.activeElement` by then).
  useEffect(() => {
    returnToRef.current = document.activeElement as HTMLElement | null;
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => () => returnToRef.current?.focus?.(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <button
        type="button"
        className="a-scrim"
        aria-label="Close subrunner report"
        tabIndex={-1}
        onClick={onClose}
        data-testid="artifact-scrim"
      />
      <aside
        className="artifact"
        role="dialog"
        aria-label="Subrunner report"
        data-testid="subrunner-panel"
      >
        <button
          ref={closeRef}
          type="button"
          className="a-close"
          onClick={onClose}
          aria-label="Close"
          data-testid="artifact-close"
        >
          <X size={18} aria-hidden="true" />
        </button>
        <span className="eyebrow">Subrunner</span>
        <h3>{card.text}</h3>
        {card.subrunnerReport ? (
          <div className="a-body" data-testid="subrunner-report">
            <MarkdownChunk content={card.subrunnerReportFull ?? card.subrunnerReport} />
          </div>
        ) : (
          <p className="a-body">No report was recorded for this subrunner.</p>
        )}
      </aside>
    </>
  );
}
