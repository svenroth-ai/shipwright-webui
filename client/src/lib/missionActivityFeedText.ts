/**
 * Text-extraction helpers for `missionActivityFeed.ts`'s reducer: per-card
 * command labels, and the bounded raw-output excerpt + question-answer
 * matching that back the `detail`/`question` fields
 * (iterate-2026-08-20-mission-feed-content). Split out of the reducer file
 * itself once it crossed the project's 300-line convention — pure text
 * transforms with no dependency on the reducer's mutation state machine.
 */
import stripAnsi from "strip-ansi";
import { assistantText, type AssistantEvent, type ParsedEvent } from "../external/session-parser";
import { sanitizeProofText, stripBidiOverrides, stripC1Controls, stripControl } from "./proofLines";
import type { ActivityCard } from "./missionActivityFeedTypes";

/**
 * First-line headline text, sanitized and length-capped for compact display.
 * `maxLen` defaults to the existing 280-char headline budget; pass
 * `Infinity` (`cleanFull`) to recover the complete first line — needed
 * because a real turn is very often ONE long paragraph with no internal
 * newline, so `ownProseRest` (everything after the first line) is empty and
 * the 280-char cap was silently discarding the rest of that paragraph with
 * no way to ever see it again (reported: "nie croppen",
 * iterate-2026-09-05-mission-feed-ux-gaps).
 */
export const clean = (value: string, maxLen = 280) => sanitizeProofText(value.split("\n")[0] ?? "", maxLen);
/** The untruncated counterpart of `clean()` — same sanitization, no cap. */
export const cleanFull = (value: string) => clean(value, Infinity);

/** One assistant turn's own words, split into a headline (`ownProse`, first
 * non-empty line) and the rest (`ownProseRest`), each with an untruncated
 * `xFull` counterpart (iterate-2026-09-05-mission-feed-ux-gaps: "nie
 * croppen"). A turn's own explanation replaces the generic bucket sentence
 * when Claude wrote one (iterate-2026-08-13-mission-mobile-visual), reusing
 * the same raw-JSONL `assistantText()` narrator-transcript.ts already
 * narrates from — purely deterministic text extraction, never a new LLM
 * call. Extracted out of `deriveActivityFeed`'s per-turn loop
 * (iterate-2026-09-05-mission-feed-ux-gaps, bloat-ceiling split) — pure text
 * transform with no dependency on the reducer's mutation state machine.
 */
/** Same extraction `extractOwnProse` does, over already-split lines rather
 *  than a raw event — lets a caller pre-process the lines (e.g. stripping
 *  the /shipwright-iterate banner block, `missionActivityFeedClassify.ts`'s
 *  `stripIterateBanner`) before headline/rest extraction runs, instead of
 *  discarding a whole turn's prose whenever it happens to contain that
 *  block (external code review catch, medium, iterate-2026-09-20-mission-
 *  feed-transcript-fidelity). */
export function proseFromLines(lines: readonly string[]): {
  ownProse: string; ownProseFull: string; ownProseRest: string; ownProseRestFull: string;
} {
  const firstNonEmptyIdx = lines.findIndex((line) => line.trim().length > 0);
  const ownProse = clean(firstNonEmptyIdx === -1 ? "" : lines[firstNonEmptyIdx]);
  const ownProseFull = firstNonEmptyIdx === -1 ? "" : cleanFull(lines[firstNonEmptyIdx]);
  // The turn's own words BEYOND its headline — never a bare `slice(1)`,
  // which would leak a leading blank line's absence of content back in as
  // if it were the headline (Internal Plan/External LLM Review finding).
  // `join("\n")`, never space-joined or empty-line-filtered like
  // `excerpt()`: this is plain-text-rendered prose, and blank lines are
  // real paragraph breaks in it.
  const ownProseRestRaw = firstNonEmptyIdx === -1 ? "" : lines.slice(firstNonEmptyIdx + 1).join("\n");
  const ownProseRest = ownProseRestRaw.trim().length > 0 ? explanationExcerpt(ownProseRestRaw) : "";
  const ownProseRestFull = ownProseRestRaw.trim().length > 0 ? explanationExcerpt(ownProseRestRaw, Infinity, Infinity) : "";
  return { ownProse, ownProseFull, ownProseRest, ownProseRestFull };
}

export function extractOwnProse(event: AssistantEvent): {
  ownProse: string; ownProseFull: string; ownProseRest: string; ownProseRestFull: string;
} {
  return proseFromLines(assistantText(event).split("\n"));
}

export function isCompactionMarker(event: ParsedEvent): boolean {
  return event.kind === "system" && (
    /compact/i.test(event.subtype ?? "") || /context automatically compacted/i.test(event.text)
  );
}

export function commandDetail(input: unknown): string {
  const value = input as Record<string, unknown> | undefined;
  return typeof value?.command === "string" ? value.command
    : typeof value?.file_path === "string" ? value.file_path
    : typeof value?.description === "string" ? value.description
    : typeof value?.pattern === "string" ? value.pattern : "";
}

/**
 * The compact chip label shown inline in the feed. `maxLen` defaults to the
 * existing 180-char chip budget; pass `Infinity` (`commandLabelFull`) to
 * recover the complete, untruncated command/detail text for a click-to-
 * expand affordance (reported: commands could not be inspected in full,
 * iterate-2026-09-05-mission-feed-ux-gaps).
 */
export function commandLabel(name: string, input: unknown, maxLen = 180): string {
  const detail = commandDetail(input);
  return detail ? `${name}: ${sanitizeProofText(detail, maxLen)}` : `Used ${name}`;
}
/** The untruncated counterpart of `commandLabel()`. Still routes through
 * `sanitizeProofText`'s single-line collapse (code review note), so a
 * multi-line command (heredoc, multi-line commit message body) loses its
 * real line breaks in the expanded view same as the truncated chip already
 * did — accepted for this iterate; `excerpt()`/`explanationExcerpt()` are
 * the newline-preserving alternatives used for `detailFull`/`explanationFull`
 * where that mattered more. */
export function commandLabelFull(name: string, input: unknown): string {
  return commandLabel(name, input, Infinity);
}

/**
 * Attaches one command chip's label to a card, deduplicated by label (same
 * contract `add()`'s coalescing already relied on), and records the FULL
 * untruncated text under `commandFullText` only when it actually differs
 * from the label — never a needless map entry for a chip that was never
 * truncated. Shared between `missionActivityFeed.ts` (card creation) and
 * `missionActivityFeedResolve.ts` (retry/recovery, which re-attaches a
 * command to an EXISTING card) so both stay byte-identical.
 */
export function attachCommand(card: Pick<ActivityCard, "commands" | "commandFullText" | "commandCount">, label: string, full: string, options: { overwrite?: boolean } = {}): void {
  // The TRUE tool-call count, separate from `commands.length` (24th-round
  // external review catch, openai, medium): two DISTINCT tool-use events can
  // share one deduplicated label (e.g. two identical `Read` calls), so the
  // collapsed "N commands" summary must not read the deduped array's length
  // as if it were the call count. Falls back to `commands.length` only for a
  // card's FIRST attach, relying on every card-creation site initializing
  // `commands: []` (26th-round external review catch, glm, low — every
  // current site does; a future site pre-populating `commands` outside this
  // function would need to also seed `commandCount`, or this undercounts).
  // 41st-round catch (glm, low), DECLINED: seeding from 0 unconditionally is
  // strictly WORSE — for a card that DID pre-populate `commands`, `??
  // commands.length` counts those labels while 0 discards them. And a THROWING
  // assertion belongs nowhere here: this reducer runs inside the Mission tab's
  // render, so it would blank the panel rather than miscount one chip.
  card.commandCount = (card.commandCount ?? card.commands.length) + 1;
  if (!card.commands.includes(label)) card.commands.push(label);
  // Never overwrite an already-recorded full text for this label by default
  // (code review catch): two DIFFERENT commands can share the same
  // truncated 180-char label (e.g. two long paths that diverge only past
  // the cap), and the chip lookup is by label alone — silently flipping the
  // stored full text to whichever command happened to attach second would
  // make the click-to-expand view lie about which command it belongs to.
  //
  // `options.overwrite` is the deliberate exception (doubt-review catch):
  // a retry/recovery call site isn't attaching a SIBLING command that
  // happens to share a label — it's replacing the ENTIRE card's stale
  // state (status/detail already get cleared unconditionally right next to
  // these call sites) with the incoming, just-succeeded command's own
  // data, so that data must win even over a same-label collision.
  if (full !== label && (options.overwrite || !card.commandFullText?.[label])) {
    card.commandFullText = { ...card.commandFullText, [label]: full };
  }
}

/**
 * Bounded, sanitized raw-output excerpt: its own multi-line truncation, not
 * `sanitizeProofText` (which single-line-truncates and would collapse a
 * multi-line failure back to one line, defeating the point).
 */
export function excerpt(content: string, maxLines = 4, maxChars = 320): string {
  const allLines = stripControl(stripAnsi(content))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lines = allLines.slice(0, maxLines);
  if (lines.length === 0) return "";
  const joined = lines.join("\n");
  if (joined.length > maxChars) return `${joined.slice(0, maxChars)}…`;
  // Line-count truncation is otherwise silent (doubt-review catch): dropping
  // lines beyond `maxLines` with no marker left a reader unable to tell a
  // partial excerpt from the complete output. Appended to the last line
  // (not a new line) so a `split("\n")` line count still matches `maxLines`.
  return allLines.length > maxLines ? `${joined}…` : joined;
}

/**
 * Bounded excerpt of assistant-authored prose (a turn's own words beyond
 * its first line, iterate-2026-08-25-mission-feed-progress-narration) —
 * rendered as plain text, never markdown, so unlike `excerpt()` this
 * preserves blank lines (real paragraph breaks in the source text) instead
 * of filtering them out, and truncates on Unicode code points rather than
 * UTF-16 units so an emoji/CJK character at the cap is never split into a
 * lone surrogate. Sanitized the same way `card.text` already is
 * (`stripAnsi`/`stripControl`/`stripC1Controls`, plus the bidi-override
 * filter shared with `sanitizeProofText`) minus only the single-line
 * collapse, which would destroy multi-line structure.
 */
export function explanationExcerpt(content: string, maxLines = 6, maxChars = 600): string {
  const allLines = stripC1Controls(stripBidiOverrides(stripControl(stripAnsi(content))))
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""));
  const lines = allLines.slice(0, maxLines);
  const joined = lines.join("\n").trim();
  if (!joined) return "";
  const codePoints = Array.from(joined);
  if (codePoints.length > maxChars) return `${codePoints.slice(0, maxChars).join("")}…`;
  // Same silent-truncation guard as `excerpt()` — appended to the last
  // line, not a new one, so the line count still matches `maxLines`.
  return allLines.length > maxLines ? `${joined}…` : joined;
}

export { summarizeBlockerError } from "./missionActivityFeedBlockerText";

const normalizeForMatch = (value: string) => value.trim().toLowerCase();

/**
 * Real CLI resolution content is plain text matching one option's label
 * verbatim (confirmed against a captured real transcript fixture,
 * `askuser-roundtrip.jsonl`). A resolution routed through the webui's own
 * multi-question answer serialization (`askUserPayload.ts`
 * `serializePartAnswers`) instead uses `## header\nbody` blocks — handled
 * defensively since `askUserQuestionSummary()` only surfaces the FIRST
 * question (existing precedent), matching that shape's first block.
 */
export function resolveQuestionAnswer(rawContent: string, options: string[]): { picked?: string; answer?: string; answerFull?: string } {
  const trimmed = rawContent.trim();
  const direct = options.find((option) => normalizeForMatch(option) === normalizeForMatch(trimmed));
  if (direct) return { picked: direct };
  const block = /^##\s*.+\n([\s\S]*?)(?:\n\n##|$)/.exec(trimmed);
  const body = (block ? block[1] : trimmed).trim();
  const bodyMatch = options.find((option) => normalizeForMatch(option) === normalizeForMatch(body));
  if (bodyMatch) return { picked: bodyMatch };
  const source = body || trimmed;
  const excerpted = excerpt(source);
  if (!excerpted) return {};
  const full = excerpt(source, Infinity, Infinity);
  return full.length > excerpted.length ? { answer: excerpted, answerFull: full } : { answer: excerpted };
}

/**
 * Strips ONLY a duplicate sentence from `text` — AC1's "a sentence that is
 * an exact/near-exact auto-generated duplicate", not the whole-text equality
 * this shipped with first (external code review, both providers, medium: a
 * duplicate sentence embedded in a longer narrative, e.g. "Investigated the
 * flaky test. Merged as \"X\".", rendered unstripped). Matches `duplicate` as
 * a whitespace-tolerant sequence of its own tokens (the "near-exact"
 * tolerance the AC also asks for — trailing-whitespace/line-break variants),
 * removes only that span, and stitches the remaining narration back together
 * with a single space. Returns `text` unchanged when no `duplicate` is given
 * or none is found.
 */
export function stripDuplicateSentence(text: string, duplicate: string | null | undefined): string {
  if (!duplicate) return text;
  const trimmedDuplicate = duplicate.trim();
  if (!trimmedDuplicate) return text;
  if (text.trim() === trimmedDuplicate) return "";
  const pattern = trimmedDuplicate.split(/\s+/).map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const match = new RegExp(pattern).exec(text);
  if (!match) return text;
  const before = text.slice(0, match.index).trimEnd();
  const after = text.slice(match.index + match[0].length).trimStart();
  return before && after ? `${before} ${after}` : before || after;
}
