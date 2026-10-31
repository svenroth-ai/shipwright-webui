/**
 * "Run result" card (campaign mission-desktop-style-v2 V2, README row 5): the
 * feed's evidence lines (tests / requirement / decisions / review / commit)
 * as ONE card — status pill (always text, never colour alone), statement, and
 * one action button named after its target. The commit/PR delivery is the
 * last row. Read-only display; the buttons only open the artifact panel.
 */
import type { ActivityCard } from "../../../lib/missionActivityFeed";
import { resultButtonLabel, resultRowTitle } from "../../../lib/missionActivityFeedResult";
import { stripDuplicateSentence } from "../../../lib/missionActivityFeedText";
import type { CommitArtifact } from "../../../lib/missionContextApi";
import { ChevronRightIcon, CheckIcon, XIcon } from "./MissionFeedIcons";
import { mergeStateLabel, pillLabel } from "./MissionActivityFeedCardParts";

function statusPill(card: ActivityCard): string {
  const label = pillLabel(card);
  if (label) return label;
  return card.status === "ok" ? "Done" : card.status === "err" ? "Failed" : card.status === "warn" ? "Needs attention" : "Pending";
}

function Pill({ status, label }: { status?: ActivityCard["status"]; label: string }) {
  return (
    <span className="mc-pill" data-status={status ?? "none"}>
      {status === "ok" ? <CheckIcon /> : status === "err" ? <XIcon /> : null}
      {label}
    </span>
  );
}

function OpenButton({ artifact, onArtifactClick }: { artifact: string; onArtifactClick?: (artifact: string) => void }) {
  if (!onArtifactClick) return null;
  // aria-label keeps the long-standing "Open <artifact>" accessible name; the visible text is the target.
  return (
    <button type="button" className="mc-result-btn" aria-label={`Open ${artifact}`} onClick={() => onArtifactClick(artifact)}>
      {resultButtonLabel(artifact)}<ChevronRightIcon />
    </button>
  );
}

export function RunResultCard({
  rows, delivery, onArtifactClick, commitArtifact,
}: {
  rows: ActivityCard[];
  delivery: ActivityCard | null;
  onArtifactClick?: (artifact: string) => void;
  commitArtifact: CommitArtifact | null;
}) {
  const pr = delivery && delivery.artifact === "commit" ? commitArtifact?.detail : null;
  const deliveryText = delivery ? stripDuplicateSentence(delivery.textFull || delivery.text, pr?.message ? `Merged as "${pr.message}".` : null) : "";
  return (
    <section className="mc-result" data-testid="run-result-card" aria-label="Run result">
      <div className="mc-result-h">Run result</div>
      {rows.map((card, i) => (
        <div className="mc-result-row" data-testid="run-result-row" data-artifact={card.artifact} key={`${card.artifact}-${i}`}>
          <Pill status={card.status} label={statusPill(card)} />
          <div className="mc-result-t">
            {resultRowTitle(card.artifact as string)}
            {card.text && <small>{card.text}</small>}
          </div>
          <OpenButton artifact={card.artifact as string} onArtifactClick={onArtifactClick} />
        </div>
      ))}
      {delivery && (
        <div className="mc-result-commit" data-testid="run-result-delivery">
          <Pill status={pr ? (pr.merge === "merged" ? "ok" : "warn") : delivery.status ?? "ok"} label={pr ? mergeStateLabel(pr.merge) : "Completed"} />
          <div className="t">
            {pr?.message ?? (deliveryText || resultRowTitle(delivery.artifact as string))}
            {pr?.message && deliveryText && <small>{deliveryText}</small>}
          </div>
          {pr && pr.prNumber != null && (
            /^https:\/\//.test(pr.prUrl ?? "")
              ? <a className="m" href={pr.prUrl ?? undefined} target="_blank" rel="noopener noreferrer">#{pr.prNumber}</a>
              : <span className="m">#{pr.prNumber}</span>
          )}
          <OpenButton artifact={delivery.artifact as string} onArtifactClick={onArtifactClick} />
        </div>
      )}
    </section>
  );
}
