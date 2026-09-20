/**
 * Per-turn extraction helpers for `missionActivityFeed.ts`'s reducer: the
 * intro-banner check + prose override for one ASSISTANT turn, and the card
 * a human's own typed USER turn produces. Split into its own file (bloat-
 * ceiling — the reducer itself has no budget left) rather than folded into
 * `missionActivityFeedText.ts`, which is at the same limit
 * (iterate-2026-09-20-mission-feed-transcript-fidelity). `humanText()` lives
 * here too, not in `session-parser.ts` (moved during code review, same run)
 * — this file is its ONLY consumer, and `session-parser.ts` is already a
 * grandfathered over-limit file with no spare headroom.
 */
import { assistantText, type AssistantEvent, type UserEvent } from "../external/session-parser";
import { containsIterateBanner, stripIterateBanner } from "./missionActivityFeedClassify";
import { explanationExcerpt, proseFromLines } from "./missionActivityFeedText";
import type { ActivityCard } from "./missionActivityFeedTypes";
import { INJECTED } from "./narrator-facts";

const SYSTEM_REMINDER_SPAN = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

/** One shared cleanup for "strip harness noise, keep whatever real words are
 *  left" — applied identically to every content shape `humanText` handles
 *  below (round-2 code review catch, medium: the first pass only ran an
 *  equivalent check inside the array-of-blocks branch, so the plain-string
 *  shape — which is exactly how BOTH a real prompt and an injected
 *  continuation banner arrive — skipped it entirely). Strips EVERY
 *  `<system-reminder>` span rather than only matching when the envelope is
 *  the WHOLE string (round-3 code review catch, low): a real typed reply
 *  with a reminder appended in the SAME block — "do X\n\n<system-reminder>
 *  ...</system-reminder>" — previously passed through with the reminder
 *  rendered verbatim in the card. Returns `""` when nothing real is left,
 *  including when a leading `INJECTED` prefix remains after stripping. */
function stripInjectedNoise(text: string): string {
  const withoutReminders = text.replace(SYSTEM_REMINDER_SPAN, "").trim();
  return INJECTED.some((p) => withoutReminders.startsWith(p)) ? "" : withoutReminders;
}

/** Extracts ONLY a user event's own genuinely typed text — never a
 * `tool_result` block's content, unlike `userText()` in `session-parser.ts`
 * (which prefixes those with `[tool_result]` for a different, minimal-viewer
 * purpose). Most `user`-role JSONL events are synthetic tool-result carriers
 * with no human words in them at all; this returns `""` for those so a
 * caller can tell "nothing typed here" apart from "the terminal reply was
 * empty". Handles the same three content shapes `userText()` does (string /
 * array of blocks / `{content: string}`) so a genuinely typed reply in any
 * of them is never silently dropped (round-2 catch: the object shape was
 * missing entirely, the exact gap report item 1 asked to close). Drops the
 * same harness-injected shapes `narrator-facts.ts`'s `askFrom` already
 * filters via the shared `isInjectedText` above — reusing the SAME exported
 * `INJECTED` list rather than forking a second copy that could drift. */
export function humanText(e: UserEvent): string {
  const c = e.content;
  if (typeof c === "string") return stripInjectedNoise(c);
  if (Array.isArray(c)) {
    const parts: string[] = [];
    for (const block of c) {
      if (block && typeof block === "object") {
        const b = block as { type?: unknown; text?: unknown };
        if (b.type !== "text" || typeof b.text !== "string") continue;
        const cleaned = stripInjectedNoise(b.text);
        if (cleaned) parts.push(cleaned);
      }
    }
    return parts.join("\n");
  }
  if (c && typeof c === "object") {
    const obj = c as { content?: unknown };
    if (typeof obj.content === "string") return stripInjectedNoise(obj.content);
  }
  return "";
}

export interface TurnProse {
  isBannerTurn: boolean;
  ownProse: string;
  ownProseFull: string;
  ownProseRest: string;
  ownProseRestFull: string;
}

export interface PendingNarration {
  prose: string;
  proseFull: string;
  proseRest: string;
  proseRestFull: string;
  staleness: number;
  timestamp?: string;
}

/** A still-waiting `pendingNarration` with no later tool-bearing turn left to
 * consume it would otherwise vanish with no card at all — the exact shape of
 * a closing summary (SKILL.md's F12 prints its own text, then the run simply
 * ends). Flushed as its own `system`-kind card (a plain note, no kind
 * label/pill to imply a category it doesn't have) rather than dropped
 * silently (reported: "Schluss ... wird nicht geprintet",
 * iterate-2026-09-20-mission-feed-transcript-fidelity). The caller must push
 * this AFTER `clearMultiTurnExplanations`, not before — that pass would
 * otherwise strip the returned card's `explanation` right back off, since it
 * never ran through `cardTurnCounts` at all. */
export function flushPendingNarration(pendingNarration: PendingNarration | null): ActivityCard | null {
  if (!pendingNarration) return null;
  const { prose, proseFull, proseRest, proseRestFull, timestamp } = pendingNarration;
  return {
    kind: "system",
    text: prose,
    textFull: proseFull.length > prose.length ? proseFull : undefined,
    explanation: proseRest || undefined,
    explanationFull: proseRest && proseRestFull.length > proseRest.length ? proseRestFull : undefined,
    commands: [],
    timestamp,
  };
}

/** One assistant turn's banner status + own words. Checked BEFORE the turn's
 * prose is even extracted, and regardless of whether it also calls a tool —
 * the intro banner does not always land as a pure-narration turn on its own
 * (SKILL.md's very next instruction is a tool call, and a real autonomous
 * turn can combine both). A narrower "pure-narration only" check left the
 * combined shape falling through to plain `extractOwnProse`, which reads a
 * turn's FIRST NON-EMPTY line — the banner's `====` border or its own text
 * line — and hung it on whatever unrelated tool call the turn happened to
 * make, so the real start moment never appeared as its own card either way
 * (reported: "Start des Iterate wird nicht geprintet",
 * iterate-2026-09-20-mission-feed-transcript-fidelity). Only the fixed
 * banner BLOCK itself is stripped before prose extraction runs — not the
 * whole turn's text (external code review catch, medium: an earlier version
 * discarded ALL of a banner turn's prose unconditionally, so a turn that
 * combined the banner with genuine narration lost that narration too, and
 * via the empty-tool-only-card filter could then drop its own tool card
 * entirely). `stripIterateBanner` bounds itself to the banner's own known
 * lines, so real narration before or after the block survives untouched. */
export function extractTurnProse(event: AssistantEvent): TurnProse {
  const lines = assistantText(event).split("\n");
  const isBannerTurn = containsIterateBanner(lines);
  const { ownProse, ownProseFull, ownProseRest, ownProseRestFull } = proseFromLines(stripIterateBanner(lines));
  return { isBannerTurn, ownProse, ownProseFull, ownProseRest, ownProseRestFull };
}

/** A human's own typed reply as its own card — never a `tool_result`
 * carrier (see `humanText()`'s doc comment) — so it reads back the same way
 * it would in the terminal itself (reported: "meine Antworten gehören auch
 * da hinein", iterate-2026-09-20-mission-feed-transcript-fidelity). Bounded
 * the same way an assistant turn's own trailing prose already is; `null`
 * when this user event carried no genuinely typed text (the common case —
 * most `user`-role events are synthetic tool-result carriers). */
export function buildUserReplyCard(event: UserEvent): ActivityCard | null {
  const typed = humanText(event);
  if (!typed.trim()) return null;
  const bounded = explanationExcerpt(typed);
  const full = explanationExcerpt(typed, Infinity, Infinity);
  return { kind: "user", text: bounded, textFull: full.length > bounded.length ? full : undefined, commands: [], timestamp: event.timestamp };
}
