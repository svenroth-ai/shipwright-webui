/**
 * Small presentational helpers for `MissionActivityFeedCard.tsx` — split out
 * at the 300-line convention (iterate-2026-09-20-mission-feed-transcript-fidelity).
 * No state, no JSX composition decisions — pure label/accent/formatting lookups
 * plus the one shared expand/collapse toggle button. */
import type { ActivityCard } from "../../../lib/missionActivityFeed";
import type { MergeState } from "../../../lib/missionContextApi";

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
  if (card.kind === "subrunner") {
    // "done" and "failed" were visually identical (external code review,
    // openai, medium: "the required done/failed status is invisible") — a
    // failed subagent now gets the same err accent as a blocker.
    return card.subrunnerStatus === "running" ? { color: "var(--warn)", line: "var(--warn-line)" }
      : card.subrunnerStatus === "failed" ? { color: "var(--err)", line: "var(--err-line)" }
      : { color: "var(--muted)", line: "var(--line-strong)" };
  }
  return { color: "var(--accent)", line: "var(--accent-line)" };
}

export function pillLabel(card: ActivityCard): string | null {
  if (!card.status) return null;
  if (card.kind === "test") return card.status === "ok" ? "Passing" : card.status === "err" ? "Failing" : "Unclear";
  if (card.kind === "spec") return "Recorded";
  if (card.kind === "review") return "Passed";
  return null;
}

export function mergeStateLabel(merge: MergeState): string {
  return merge === "merged" ? "merged" : merge === "pending" ? "pending merge" : "merge state unknown";
}

/** The feed's one-time "Session started · <date>, <time>" divider text
 * (iterate-2026-09-26-mission-tab-subrunner — kind labels and per-card
 * timestamps were removed site-wide; this is the sole surviving time
 * reference). Guards `at` the same way the removed per-card time display
 * did: an unparseable date renders nothing rather than "Invalid Date". */
export function formatSessionStart(at: string): string | null {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return null;
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const isToday = date.toDateString() === new Date().toDateString();
  const day = isToday ? "Today" : date.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${day}, ${time}`;
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
