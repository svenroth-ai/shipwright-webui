/*
 * AgentTranscriptFeed - the Transcript tab's body (V3): a subagent's JSONL rendered by the SAME
 * components and classes as the Mission chat (FeedCard + .mc-feed-*, via session-parser +
 * deriveActivityFeed) on a light token set (.ag-feed), instead of the old BubbleTranscript.
 * The first user record is the "Prompt from the session" card, not a human bubble; a message the
 * coordinator sent mid-run is a labelled card too. Read-only: no composer, no write surface.
 */

import { useRef } from "react";

import type { ExternalTask } from "../../../lib/externalApi";
import type { AgentFeed } from "../../../lib/agentTranscriptFeed";
import { useAutoScroll } from "../../../hooks/useAutoScroll";
import { MarkdownChunk } from "../BubbleTranscript/MarkdownChunk";
import { FeedCard } from "./MissionActivityFeedCard";

function clock(ts: string | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? ` · ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "";
}

function PromptCard({ text, timestamp, first }: { text: string; timestamp?: string; first: boolean }) {
  return (
    <article className="mc-feed-card mc-handback" data-role="prompt" data-testid="agent-prompt-card">
      <div className="mc-handback-h">
        <span className="mc-handback-tag">{first ? "Prompt from the session" : "Message to this agent"}</span>
        <span>to this agent{clock(timestamp)}</span>
      </div>
      <div className="mc-handback-body"><MarkdownChunk tableWrap content={text} /></div>
    </article>
  );
}

export function AgentTranscriptFeed({ feed, task, onOpenAgent, canOpenAgent }: {
  feed: AgentFeed;
  task: ExternalTask;
  onOpenAgent: (agentId: string) => void;
  canOpenAgent: (agentId: string) => boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Keyed on the total (not the window): "Load older" widens the top and must not yank the reader to the bottom.
  useAutoScroll(ref, `${feed.total}`);
  // Stable keys (kind, timestamp, first command, nth duplicate): position-based keys remount every card on each
  // poll and collapse expanded details (V3 doubt O4).
  const seen = new Map<string, number>();
  return (
    <div ref={ref} className="ag-feed" role="log" aria-label="Agent transcript" tabIndex={0} data-testid="agent-feed">
      {feed.items.length === 0 ? (
        <p className="ag-empty">Nothing to show yet.</p>
      ) : feed.items.map(({ card, role }) => {
        const base = `${role}-${card.kind}-${card.timestamp ?? ""}-${card.commands[0] ?? ""}`;
        const nth = seen.get(base) ?? 0;
        seen.set(base, nth + 1);
        return (
        <div className="mc-feed-entry" data-entry-kind={role === "card" ? card.kind : "prompt"} key={`${base}-${nth}`}>
          {role === "card" ? (
            <FeedCard card={card} task={task} commitArtifact={null} onSubrunnerClick={onOpenAgent} canOpenAgent={canOpenAgent} />
          ) : (
            <PromptCard text={card.textFull ?? card.text} timestamp={card.timestamp} first={role === "prompt"} />
          )}
        </div>
        );
      })}
    </div>
  );
}
