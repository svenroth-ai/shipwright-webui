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
  /** The untruncated counterpart of `answer` — set only when the real
   * content is actually longer than the bounded excerpt shown by default
   * (iterate-2026-09-05-mission-feed-ux-gaps: an answer's own excerpt was
   * silently cropped with no way to read the rest). */
  answerFull?: string;
}

export interface ActivityCard {
  kind: ActivityKind;
  text: string;
  /** The untruncated counterpart of `text` — set only when the turn's real
   * headline text is actually longer than the 280-char display cap (most
   * often a real turn's ENTIRE explanation, since a genuine turn is very
   * often one long paragraph with no internal newline — so there is no
   * separate `explanation` to fall back to). Never set for a static/generic
   * card text (nothing to expand). iterate-2026-09-05-mission-feed-ux-gaps. */
  textFull?: string;
  commands: string[];
  /** Untruncated command/detail text for one of `commands`' entries, keyed
   * by that (possibly-truncated) label — populated only when the full text
   * actually differs from the label shown, so a click-to-expand affordance
   * has something real to reveal (iterate-2026-09-05-mission-feed-ux-gaps:
   * a long Bash command could not be inspected past its 180-char preview). */
  commandFullText?: Record<string, string>;
  artifact?: ArtifactKind;
  /** ISO-8601 timestamp of the JSONL event that created this card (its OWN
   * transcript timestamp, never a client-side "now") — absent when the source
   * event carried none (older transcripts predate the field), AND for a card
   * synthesized from MissionContext with no source event at all (e.g. the
   * test/spec/review/delivery cards missionActivityFeedReconcile.ts builds).
   * Set once, at creation; a later event coalescing into the same card does
   * not move it, since the card represents when the activity STARTED
   * (iterate-2026-08-31-mission-feed-gaps). */
  timestamp?: string;
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
  /** The untruncated counterpart of `explanation` — same "set only when
   * real truncation happened" contract as `textFull`
   * (iterate-2026-09-05-mission-feed-ux-gaps). */
  explanationFull?: string;
  /** Pill state, always derived from MissionContext — never string-matched
   * from `text`. */
  status?: "ok" | "err" | "warn";
  /** The untruncated counterpart of `detail` — same contract as `textFull`
   * (iterate-2026-09-05-mission-feed-ux-gaps). */
  detailFull?: string;
  question?: ActivityQuestion;
}

export interface ActivityFeed {
  outcome: string;
  cards: ActivityCard[];
}
