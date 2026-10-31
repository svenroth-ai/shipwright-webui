/**
 * Subrunner row (campaign mission-desktop-style-v2 V2, README row 7): a
 * delegated subagent as its own compact row — agent chip, title, meta
 * "Subagent · <type> · finished in N min", and one action ("Report" / "View").
 * Deliberately NOT styled like the evidence lines of the Run result card or
 * the grey tool lines. The meta always spells the state out in words
 * (running / finished / failed / killed / stopped) — never colour alone.
 */
import { MarkdownChunk } from "../BubbleTranscript/MarkdownChunk";
import type { ActivityCard } from "../../../lib/missionActivityFeed";
import { AgentIcon, ChevronRightIcon } from "./MissionFeedIcons";
import { formatElapsed } from "./MissionActivityFeedCardParts";

function stateMeta(card: ActivityCard): string {
  if (card.subrunnerStatus === "running") return "running";
  const verb = card.subrunnerEndStatus === "killed" ? "killed after" : card.subrunnerEndStatus === "stopped" ? "stopped after"
    : card.subrunnerStatus === "failed" ? "failed after" : "finished in";
  const elapsed = formatElapsed(card.timestamp, card.subrunnerEndedAt);
  if (!elapsed) return verb.replace(/ (after|in)$/, "");
  return `${verb} ${elapsed}`;
}

/** The state as a TEXT pill label (never colour alone). */
function statePill(card: ActivityCard): { label: string; tone: "ok" | "err" | "warn" } {
  if (card.subrunnerStatus === "running") return { label: "Running", tone: "warn" };
  if (card.subrunnerEndStatus === "killed") return { label: "Killed", tone: "err" };
  if (card.subrunnerEndStatus === "stopped") return { label: "Stopped", tone: "warn" };
  return card.subrunnerStatus === "failed" ? { label: "Failed", tone: "err" } : { label: "Done", tone: "ok" };
}

export function SubrunnerRow({
  card, onSubrunnerClick, canOpenAgent,
}: {
  card: ActivityCard;
  onSubrunnerClick?: (subrunnerId: string) => void;
  canOpenAgent?: (subrunnerId: string) => boolean;
}) {
  const id = card.subrunnerId;
  const running = card.subrunnerStatus === "running";
  const failed = card.subrunnerStatus === "failed";
  const canClick = Boolean(id && onSubrunnerClick && (running ? canOpenAgent?.(id!) : true));
  const label = running ? "View" : "Report";
  const aria = running ? "View agent"
    : failed ? (card.subrunnerEndStatus ? `View failure details (${card.subrunnerEndStatus})` : "View failure details")
    : card.subrunnerEndStatus ? `View subrunner report (${card.subrunnerEndStatus})` : "View subrunner report";
  const pill = statePill(card);
  const meta = ["Subagent", card.subrunnerType, stateMeta(card)].filter(Boolean).join(" · ");
  return (
    <div className="mc-sub" data-kind="subrunner" data-testid="subrunner-row" data-status={card.subrunnerStatus}>
      <span className="mc-sub-ic"><AgentIcon /></span>
      <div className="mc-sub-main">
        <span className="mc-sub-t">{card.text}</span>
        <span className="mc-sub-m mc-feed-subrunner-status" data-status={card.subrunnerStatus}>
          {running && <span className="mc-feed-subrunner-dot" aria-hidden="true" />}
          {meta}{running ? "…" : ""}
        </span>
      </div>
      <span className="mc-pill" data-status={pill.tone} data-testid="subrunner-pill">{pill.label}</span>
      {canClick && (
        <button type="button" className="mc-result-btn" aria-label={aria} onClick={() => onSubrunnerClick!(id!)}>
          {label}<ChevronRightIcon />
        </button>
      )}
      {!canClick && !running && card.subrunnerReport && (
        <div className="mc-sub-report"><MarkdownChunk content={card.subrunnerReport} /></div>
      )}
    </div>
  );
}
