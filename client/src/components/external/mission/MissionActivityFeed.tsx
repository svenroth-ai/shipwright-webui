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
          <p>{card.text}</p>
          {card.artifact && onArtifactClick ? <button type="button" className="mc-story-link" onClick={() => onArtifactClick(card.artifact!)}>Open {card.artifact}</button> : null}
          {card.commands.length ? <details><summary>Ran commands</summary><ul>{card.commands.map((command) => <li key={command}>{command}</li>)}</ul></details> : null}
        </article>
      ))}
    </div>
  </section>;
}
