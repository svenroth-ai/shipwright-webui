import { MarkdownChunk } from "../BubbleTranscript/MarkdownChunk";
import type { ActivityFeed } from "../../../lib/missionActivityFeed";

interface Props { feed: ActivityFeed; onArtifactClick?: (artifact: string) => void; }

export function MissionActivityFeed({ feed, onArtifactClick }: Props) {
  return <section className="mc-op mc-feed" data-testid="operation-card" data-live="true">
    <header className="mc-feed-pinned">
      <span className="mc-feed-label">Goal</span>
      <strong data-testid="mission-feed-goal">{feed.goal ?? "No goal has been recorded yet."}</strong>
      <span>{feed.outcome}</span>
    </header>
    <div className="mc-feed-scroll" role="log" aria-label="Activity feed" tabIndex={0} data-testid="mission-activity-feed">
      {feed.cards.length === 0 ? (
        <div className="mc-hero-empty">Waiting — nothing reliable has appeared yet.</div>
      ) : feed.cards.map((card, index) => (
        <article className="mc-feed-card" key={`${card.kind}-${index}`} data-kind={card.kind}>
          {/* card.text can carry a turn's own assistant prose (deriveActivityFeed) —
              assistant/user-influenced content, so it renders through the SAME
              safe markdown path as the rest of the transcript, never a raw <p>. */}
          <MarkdownChunk content={card.text} />
          {card.artifact && onArtifactClick ? <button type="button" className="mc-story-link" onClick={() => onArtifactClick(card.artifact!)}>Open {card.artifact}</button> : null}
          {card.commands.length ? <details><summary>Ran commands</summary><ul>{card.commands.map((command) => <li key={command}>{command}</li>)}</ul></details> : null}
        </article>
      ))}
    </div>
  </section>;
}
