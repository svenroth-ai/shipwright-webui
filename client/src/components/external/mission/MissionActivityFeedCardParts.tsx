/**
 * Small presentational helpers for `MissionActivityFeedCard.tsx` — split out
 * at the 300-line convention (iterate-2026-09-20-mission-feed-transcript-fidelity).
 * No state, no JSX composition decisions — pure label/accent/formatting lookups
 * plus the one shared expand/collapse toggle button. */
import type { ActivityCard } from "../../../lib/missionActivityFeed";
import type { MergeState } from "../../../lib/missionContextApi";

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

/** "44 min" / "1 h 5 min" / "under 1 min" between two ISO timestamps; null when either is missing or unparseable. */
export function formatElapsed(start?: string, end?: string): string | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under 1 min";
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${Math.floor(minutes / 60)} h`;
}
