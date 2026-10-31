import { useMemo, useRef, type ReactNode } from "react";
import { useAutoScroll } from "../../../hooks/useAutoScroll";
import type { ActivityFeed } from "../../../lib/missionActivityFeed";
import type { CommitArtifact } from "../../../lib/missionContextApi";
import type { ExternalTask } from "../../../lib/externalApi";
import { FeedCard } from "./MissionActivityFeedCard";
import { RunResultCard } from "./RunResultCard";
import { groupRunResult } from "../../../lib/missionActivityFeedResult";
import { formatSessionStart } from "./MissionActivityFeedCardParts";

interface Props {
  feed: ActivityFeed;
  onArtifactClick?: (artifact: string) => void;
  /** Opens the right-side panel for a resolved subrunner card
   *  (iterate-2026-09-26-mission-tab-subrunner). */
  onSubrunnerClick?: (subrunnerId: string) => void;
  /** M4: true when a subrunner card's agent can open in the Agents window (also while running). */
  canOpenAgent?: (subrunnerId: string) => boolean;
  /** M4: the Agents bar, pinned below the scrolling feed. */
  footer?: ReactNode;
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

export function MissionActivityFeed({ feed, onArtifactClick, onSubrunnerClick, canOpenAgent, footer, commitArtifact, task, visible = true }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // One-time "Session started · <date>, <time>" divider (iterate-2026-09-26-
  // mission-tab-subrunner) — replaces the removed per-card timestamps.
  // Derived from the transcript's own true first parseable event timestamp
  // (`deriveActivityFeed`'s `sessionStartTimestamp`, computed from the RAW
  // events), not from `feed.cards[0]` — a session whose early turns produced
  // no SURVIVING card used to silently report whatever later turn's card
  // happened to be first as the start time instead (iterate-2026-09-28-
  // mission-feed-completeness, AC1 — reported: "Start ist abgeschnitten").
  const sessionStartLabel = feed.sessionStartTimestamp ? formatSessionStart(feed.sessionStartTimestamp) : null;
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
  // V2: the evidence-only "Open tests/requirement/…" cards fold into one "Run result" card.
  const items = useMemo(() => groupRunResult(feed.cards), [feed.cards]);
  useAutoScroll(scrollRef, `${feed.cards.length}:${items.length}:${visible}`);

  return <section className="mc-op mc-feed" data-testid="operation-card" data-live="true">
    <header className="mc-feed-pinned">
      <span data-testid="mission-feed-outcome">{feed.outcome}</span>
    </header>
    <div ref={scrollRef} className="mc-feed-scroll" role="log" aria-label="Activity feed" tabIndex={0} data-testid="mission-activity-feed">
      {sessionStartLabel && (
        <div className="mc-feed-session-start" data-testid="mission-feed-session-start">
          Session started · {sessionStartLabel}
        </div>
      )}
      {feed.cards.length === 0 ? (
        <div className="mc-hero-empty">Waiting — nothing reliable has appeared yet.</div>
      ) : items.map((item) => {
        if (item.type === "result") {
          return (
            <div className="mc-feed-entry" data-entry-kind="result" key="run-result">
              <RunResultCard rows={item.rows} delivery={item.delivery} onArtifactClick={onArtifactClick} commitArtifact={commitArtifact} />
            </div>
          );
        }
        const { card, index } = item;
        // Compare with the previous RENDERED entry (a folded card is no longer the visual neighbour).
        const prev = items[items.indexOf(item) - 1];
        const previousIsUser = prev ? prev.type === "card" && prev.card.kind === "user" : null;
        // Not just `${kind}-${index}` (doubt-review catch, iterate-2026-09-
        // 05-mission-feed-ux-gaps): a retry/recovery resolution can splice a
        // card out of the middle of this array between polls, shifting
        // every later same-kind card down one index. `FeedCard` now holds
        // real per-card `useState` (the click-to-expand affordances this
        // iterate added) that a reused React element would wrongly carry
        // over onto the shifted-in card's different content. `timestamp` +
        // the first command label are set once at creation and never move,
        // so they stay stable for the SAME logical card across polls (the
        // reducer is a pure, deterministic function of the same growing
        // event log) while reliably differing from whatever card previously
        // sat at this index.
        // KIND FIRST is load-bearing, not cosmetic (84th, glm, low, asked for
        // this marker at the edit site): `FeedCard`'s `detailExpanded`
        // state is reset ONLY by the remount a
        // kind change forces through this key. Reorder it and a card changing kind
        // keeps an expanded detail open. Pinned by
        // "remounts a card that changes kind" in `MissionActivityFeed.test.tsx`.
        const key = `${card.kind}-${card.timestamp ?? ""}-${card.commands[0] ?? ""}-${index}`;
        return (
          <div className="mc-feed-entry" data-entry-kind={card.kind} data-switch={previousIsUser !== null && (card.kind === "user") !== previousIsUser ? "true" : undefined} key={key}>
            <FeedCard card={card} onArtifactClick={onArtifactClick} onSubrunnerClick={onSubrunnerClick} canOpenAgent={canOpenAgent} commitArtifact={commitArtifact} task={task} />
          </div>
        );
      })}
    </div>
    {footer}
  </section>;
}
