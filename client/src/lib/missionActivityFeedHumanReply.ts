/**
 * A human's own typed USER turn, extracted from `missionActivityFeedTurn.ts`
 * (bloat-ceiling split, iterate-2026-09-20-mission-feed-transcript-fidelity)
 * — a self-contained concern (read a user event's genuinely typed text, turn
 * it into its own feed card) separate from assistant-turn processing
 * (banner detection, narration flush, tool dispatch). `humanText()` lives
 * here, not in `session-parser.ts` (moved during code review, same run) —
 * this file is its ONLY consumer, and `session-parser.ts` is already a
 * grandfathered over-limit file with no spare headroom.
 */
import type { UserEvent } from "../external/session-parser";
import { explanationExcerpt } from "./missionActivityFeedText";
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
