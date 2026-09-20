/**
 * Small presentational helpers for `MissionActivityFeedCard.tsx` — split out
 * at the 300-line convention (iterate-2026-09-20-mission-feed-transcript-fidelity).
 * No state, no JSX composition decisions — pure label/accent/formatting lookups
 * plus the one shared expand/collapse toggle button. */
import type { ActivityCard } from "../../../lib/missionActivityFeed";
import type { MergeState } from "../../../lib/missionContextApi";
import { formatRelativeTime } from "../../../lib/formatTime";

export const KIND_LABEL: Record<ActivityCard["kind"], string> = {
  goal: "Goal",
  investigate: "Investigate",
  spec: "Spec",
  implement: "Implement",
  test: "Test",
  review: "Review",
  "user-input": "Question",
  user: "You",
  blocker: "Blocker",
  delivery: "Delivered",
  system: "System",
};

/** Icon/node accent — always derived from `card.kind`/`card.status`
 * (MissionContext-sourced), never string-matched from `card.text`. Exported so
 * `MissionActivityFeed.tsx` can color the timeline node the same way. */
export function kindAccent(card: ActivityCard): { color: string; line: string } {
  if (card.kind === "blocker") return { color: "var(--err)", line: "var(--err-line)" };
  if (card.kind === "test") {
    return card.status === "ok" ? { color: "var(--ok)", line: "var(--ok-line)" }
      : card.status === "err" ? { color: "var(--err)", line: "var(--err-line)" }
      : card.status === "warn" ? { color: "var(--warn)", line: "var(--warn-line)" }
      : { color: "var(--muted)", line: "var(--line-strong)" };
  }
  if (card.kind === "investigate" || card.kind === "system") return { color: "var(--muted)", line: "var(--line-strong)" };
  return { color: "var(--accent)", line: "var(--accent-line)" };
}

export function pillLabel(card: ActivityCard): string | null {
  if (!card.status) return null;
  if (card.kind === "test") return card.status === "ok" ? "Passing" : card.status === "err" ? "Failing" : "Unclear";
  if (card.kind === "blocker") return "Needs attention";
  if (card.kind === "spec") return "Recorded";
  if (card.kind === "review") return "Passed";
  return null;
}

export function mergeStateLabel(merge: MergeState): string {
  return merge === "merged" ? "merged" : merge === "pending" ? "pending merge" : "merge state unknown";
}

/** Relative-time chip shared by system/non-system headers. Guards
 * `card.timestamp` (external review, LOW): the transcript is untrusted, so
 * an unparseable date renders nothing, never a literal `NaNw ago`. */
export function FeedTime({ at }: { at: string }) {
  if (!Number.isFinite(Date.parse(at))) return null;
  return (
    <span className="mc-feed-time" title={new Date(at).toLocaleString()}>
      {formatRelativeTime(at)}
    </span>
  );
}

/** A "Show more"/"Show less" toggle — local expand state, no navigation, so a
 * plain `<button>` (not a link) with `aria-expanded`. */
export function ExpandToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="mc-feed-expand-btn" aria-expanded={expanded} onClick={onToggle}>
      {expanded ? "Show less" : "Show more"}
    </button>
  );
}
