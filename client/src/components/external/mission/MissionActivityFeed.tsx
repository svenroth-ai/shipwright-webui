import { useRef, type CSSProperties } from "react";
import { useAutoScroll } from "../../../hooks/useAutoScroll";
import type { ActivityFeed } from "../../../lib/missionActivityFeed";
import type { CommitArtifact } from "../../../lib/missionContextApi";
import type { ExternalTask } from "../../../lib/externalApi";
import { FeedIcon } from "./MissionFeedIcons";
import { FeedCard, kindAccent } from "./MissionActivityFeedCard";

interface Props {
  feed: ActivityFeed;
  onArtifactClick?: (artifact: string) => void;
  commitArtifact: CommitArtifact | null;
  task: ExternalTask;
  /**
   * Whether this feed is the currently-shown compact panel. Defaults to
   * true for the desktop three-card layout, which never hides this
   * component at all. On a phone, MissionBody mounts the activity panel
   * with `hidden` while the Overview tab is active — a `hidden` element has
   * `scrollHeight` 0, so the mount-time re-pin below is a no-op, and
   * switching TO the Activity tab changes neither `feed.cards.length` nor
   * this component's own DOM node, so the layout effect never re-runs
   * (external code review, openai MEDIUM). Folding visibility into the dep
   * makes the tab switch itself trigger the bottom re-pin.
   */
  visible?: boolean;
}

export function MissionActivityFeed({ feed, onArtifactClick, commitArtifact, task, visible = true }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Opens on the LATEST activity, not the oldest, and keeps following new
  // cards as they arrive (iterate-2026-08-31-mission-feed-gaps) — this
  // container had NO scroll management at all, so a freshly mounted
  // `.mc-feed-scroll` defaulted to the browser's top-of-container start and
  // switching to the Mission tab always landed on the earliest card in the
  // run, no matter how long it had been running. Same CSS-first +
  // `useAutoScroll` safety-net pattern the embedded terminal/transcript uses
  // (DO-NOT #2) rather than a one-shot scroll — this container re-renders on
  // every ~1s transcript poll, so a hand-rolled mount-only effect would fix
  // the initial position but still leave a live run stuck once new cards
  // append below the fold.
  //
  // `visible` rides in the dep string (not a separate effect) so switching
  // TO this compact panel re-pins to bottom too — see the prop's own doc
  // comment for why the mount-time re-pin alone is a no-op on a phone.
  useAutoScroll(scrollRef, `${feed.cards.length}:${visible}`);

  return <section className="mc-op mc-feed" data-testid="operation-card" data-live="true">
    <header className="mc-feed-pinned">
      <span data-testid="mission-feed-outcome">{feed.outcome}</span>
    </header>
    <div ref={scrollRef} className="mc-feed-scroll" role="log" aria-label="Activity feed" tabIndex={0} data-testid="mission-activity-feed">
      {feed.cards.length === 0 ? (
        <div className="mc-hero-empty">Waiting — nothing reliable has appeared yet.</div>
      ) : feed.cards.map((card, index) => {
        const isSystem = card.kind === "system";
        const accent = kindAccent(card);
        return (
          <div className="mc-feed-entry" key={`${card.kind}-${index}`}>
            <div
              className="mc-feed-node"
              data-dashed={isSystem ? "true" : undefined}
              style={{ "--kind": accent.color, "--kind-line": accent.line } as CSSProperties}
            >
              <FeedIcon kind={card.kind} />
            </div>
            <FeedCard card={card} onArtifactClick={onArtifactClick} commitArtifact={commitArtifact} task={task} />
          </div>
        );
      })}
    </div>
  </section>;
}
