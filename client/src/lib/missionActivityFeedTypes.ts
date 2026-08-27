import type { ArtifactKind } from "./missionContextApi";

export type ActivityKind = "goal" | "investigate" | "spec" | "implement" | "test" | "review" | "user-input" | "blocker" | "system" | "delivery";

export interface ActivityQuestion {
  text: string;
  options: string[];
  /** Separates "genuinely still pending" from "answered" — the unresolved
   * CTA renders only while this is false, independent of whether the
   * answer matched a listed option. */
  resolved: boolean;
  picked?: string;
  answer?: string;
}

export interface ActivityCard {
  kind: ActivityKind;
  text: string;
  commands: string[];
  artifact?: ArtifactKind;
  /** Bounded, sanitized raw-output excerpt — real transcript content, never
   * a gate verdict (MissionContext stays the sole verdict source). */
  detail?: string;
  /** Bounded excerpt of prose beyond the first line already shown in `text`
   * (iterate-2026-08-25-mission-feed-progress-narration). Assistant-authored
   * prose, rendered as plain text — NEVER conflate with `detail`, which is
   * raw tool/test output from a different source and rendered as a literal
   * `<pre>` block. NOT necessarily this card's own tool-calling turn's
   * words: a real session almost never combines narration and a tool call
   * in one JSONL event, so this is sourced from that turn's own text when
   * it wrote any, otherwise the most recent preceding pure-narration turn's
   * — surviving a bounded run of intervening test/user-input-only turns,
   * not just the single immediately preceding one
   * (iterate-2026-08-27-mission-feed-narration-scroll). Either way it is
   * exactly ONE turn's words, never a blend of two — set only when exactly
   * one assistant turn contributed to this card (see `cardTurnCounts` in
   * `missionActivityFeed.ts`); never an empty string. */
  explanation?: string;
  /** Pill state, always derived from MissionContext — never string-matched
   * from `text`. */
  status?: "ok" | "err" | "warn";
  question?: ActivityQuestion;
}

export interface ActivityFeed {
  outcome: string;
  cards: ActivityCard[];
}
