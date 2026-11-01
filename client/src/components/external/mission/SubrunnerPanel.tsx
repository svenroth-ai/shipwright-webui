/*
 * SubrunnerPanel — the RIGHT panel a resolved `subrunner` card opens
 * (iterate-2026-09-26-mission-tab-subrunner). Third consumer of
 * `MissionBody`'s existing `activeNode`/right-panel mechanic (alongside
 * `ArtifactPanel`/`MissionArtifactPanel`) — reuses the same `.artifact`/
 * `.a-scrim`/`.a-close`/`.eyebrow` chrome, no new CSS recipe.
 *
 * Shows the dispatch description + the subagent's REAL answer (V3: the text is
 * chosen by `SubrunnerPanelHost` - the agent's last message, never the CLI's
 * "delivered to you as a message" pointer) plus two actions: open the agent in
 * the Agents window, and jump to its hand-back message in the chat.
 *
 * a11y: same contract as the sibling panels — role=dialog, Esc closes, focus
 * returns to the node that opened it.
 */

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import type { ActivityCard } from "../../../lib/missionActivityFeed";
import { MarkdownChunk } from "../BubbleTranscript/MarkdownChunk";
import { ChevronRightIcon } from "./MissionFeedIcons";

interface Props {
  card: ActivityCard;
  onClose: () => void;
  /** The resolved answer; omitted = fall back to what the card itself recorded. */
  answer?: string | null;
  /** Agent type + duration line, when the agent is known. */
  meta?: string | null;
  onOpenAgent?: () => void;
  onJumpToChat?: () => void;
}

function statePill(card: ActivityCard): { label: string; tone: "ok" | "bad" | "run" | "idle" } {
  if (card.subrunnerStatus === "running") return { label: "running", tone: "run" };
  if (card.subrunnerEndStatus) return { label: card.subrunnerEndStatus, tone: card.subrunnerEndStatus === "killed" ? "bad" : "idle" };
  return card.subrunnerStatus === "failed" ? { label: "failed", tone: "bad" } : { label: "completed", tone: "ok" };
}

export function SubrunnerPanel({ card, onClose, answer, meta, onOpenAgent, onJumpToChat }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnToRef = useRef<HTMLElement | null>(null);
  const text = answer !== undefined ? answer : (card.subrunnerReportFull ?? card.subrunnerReport ?? null);
  const pill = statePill(card);

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
        <div className="ag-handback">
          <span className="ag-pill" data-tone={pill.tone} data-testid="subrunner-state">{pill.label}</span>
          {meta && <span>{meta}</span>}
        </div>
        <section className="ag-block">
          <h4 className="ag-block-h">Answer returned to the session</h4>
          {text ? (
            <div className="ag-text" data-testid="subrunner-report"><MarkdownChunk content={text} /></div>
          ) : (
            <p className="ag-empty" data-testid="subrunner-no-report">No report was found for this subrunner.</p>
          )}
        </section>
        {(onOpenAgent || onJumpToChat) && (
          <div className="sr-actions">
            {onOpenAgent && (
              <button type="button" className="mc-result-btn" onClick={onOpenAgent} data-testid="subrunner-open-agent">
                Open in Agents window<ChevronRightIcon />
              </button>
            )}
            {onJumpToChat && (
              <button type="button" className="mc-result-btn" onClick={onJumpToChat} data-testid="subrunner-jump-chat">
                Jump to message in chat<ChevronRightIcon />
              </button>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
