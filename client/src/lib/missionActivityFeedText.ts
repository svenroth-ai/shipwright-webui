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
export function extractOwnProse(event: AssistantEvent): {
  ownProse: string; ownProseFull: string; ownProseRest: string; ownProseRestFull: string;
} {
  const assistantLines = assistantText(event).split("\n");
  const firstNonEmptyIdx = assistantLines.findIndex((line) => line.trim().length > 0);
  const ownProse = clean(firstNonEmptyIdx === -1 ? "" : assistantLines[firstNonEmptyIdx]);
  const ownProseFull = firstNonEmptyIdx === -1 ? "" : cleanFull(assistantLines[firstNonEmptyIdx]);
  // The turn's own words BEYOND its headline — never a bare `slice(1)`,
  // which would leak a leading blank line's absence of content back in as
  // if it were the headline (Internal Plan/External LLM Review finding).
  // `join("\n")`, never space-joined or empty-line-filtered like
  // `excerpt()`: this is plain-text-rendered prose, and blank lines are
  // real paragraph breaks in it.
  const ownProseRestRaw = firstNonEmptyIdx === -1 ? "" : assistantLines.slice(firstNonEmptyIdx + 1).join("\n");
  const ownProseRest = ownProseRestRaw.trim().length > 0 ? explanationExcerpt(ownProseRestRaw) : "";
  const ownProseRestFull = ownProseRestRaw.trim().length > 0 ? explanationExcerpt(ownProseRestRaw, Infinity, Infinity) : "";
  return { ownProse, ownProseFull, ownProseRest, ownProseRestFull };
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

// Strips leading/trailing banner-chrome characters (`====`, `----`, …) a line
// may be padded with — e.g. pytest's own `==== 1 failed, 3 passed in 0.5s ====`
// — leaving the real text inside readable on its own (external code review
// catch, this iterate). Requires a run of at least 3 padding characters (11th,
// glm, low): the prior unbounded `+` also stripped a genuine content line that
// merely STARTED or ENDED with one or two — `--flag requires an argument`,
// `# Error: bad config` — and chrome padding is always several, never one.
// 46th (glm, low), FIXED: `*`/`_`/`#`/`~` pad no common runner's banner (pytest
// uses `=`, mocha/go `-`) but ARE ordinary content. Narrowed to the two.
// 58th and 74th (glm, low, both "leave"): an error line ending in a decorative
// `---` loses it - trailing decoration only, never the error IDENTITY. The
// 74th's "strip only when padded BOTH sides" would stop the one-sided banner.
const CHROME_PAD = /^[=\-]{3,}\s*|\s*[=\-]{3,}$/g;
// Not word-boundary-scoped: exception class names embed these with no
// separator (`TypeError`, `KeyError`), so `\berror\b` would miss them.
// `err!`/`fatal:` cover npm's + git's CLI failure prefixes — 10th (openai,
// medium): npm's chatty output matched none of the rest, so the last line won.
const ERROR_MARKER = /error|exception|failed|failure|err!|fatal:/i;
// npm ends its "ERR!" block with a generic log-file pointer — it matches
// ERROR_MARKER but names no reason, so it must never win the reverse search.
const LOG_POINTER_LINE = /complete log of this run/i;
// A ZERO count is a SUCCESS report that happens to contain the word (77th,
// glm, low): `0 errors, 3 warnings` / `error: 0` on a FAILED command won the
// reverse search and announced "0 errors" as the headline — exactly the
// misleading summary requirement 4 prevents. `1 error` still matches. 78th
// (glm, low), FIXED: `\berrors?:\s*0\b` also ate `ERROR: 0 files matched,
// aborting` — a real error whose zero counts something ELSE. The `0` must now
// END its clause, so `error: 0` / `errors: 0, warnings: 3` still go and that
// line stays. Arm 1 is line-wide by design — `0 errors, 3 warnings (build
// failed elsewhere)` is WHOLLY the tally the 77th reported.
const ZERO_COUNT_LINE = /\b0 (?:errors?|failures?|failed)\b|\berrors?:\s*0(?=\s*(?:[,;.]|$))/i;
// 44th + 54th (glm, low), DECLINED as glm itself framed it ("acceptable for a
// one-liner"): weighting `err!|fatal:` over `failed` is an untriggered knob.
// 36th (glm, low): the traceback branch returned the last non-empty line, so
// trailing cleanup won. A raised exception is an optionally dotted name whose
// FINAL segment is Capitalized, then `: msg` or EOL — probed noise fails both
// ("Exception ignored in …" has a space; "cleanup: …" starts lowercase).
const PY_EXCEPTION_LINE = /^(?:[A-Za-z_]\w*\.)*[A-Z]\w*(?::\s|:$|$)/;

/**
 * A one-line, human-readable summary of a failed command's raw output — the
 * LAST error-ish line (an exception name, "failed", …), else the last
 * non-empty line, which for a Python traceback or a typical CLI failure is
 * the actual error, never a stack frame (reported: a blocker card showed only
 * a static "needs attention" sentence above the raw traceback, iterate-2026-
 * 09-16-mission-feed-render-fidelity). `""` when nothing is usable.
 */
export function summarizeBlockerError(content: string, maxLen = 200): string {
  const lines = stripControl(stripAnsi(content))
    .split("\n")
    .map((line) => line.trim().replace(CHROME_PAD, ""))
    .filter((line) => line.length > 0);
  if (lines.length === 0) return "";
  // A genuine Python traceback's LAST line is always its raised exception
  // (`ExceptionType: msg`, or a bare `StopIteration`) — never a stack frame —
  // so prefer it over the marker search once the banner is present (28th, glm,
  // low): that search can land on an EARLIER frame merely CONTAINING "error".
  if (lines.some((line) => line.startsWith("Traceback (most recent call last)"))) {
    // Search FORWARD from the LAST stack frame for the FIRST exception-shaped
    // line — not backward from the end (37th-round catch, glm, low: a
    // reverse search also matches a trailing bare capitalized word like
    // "Done"/"Cleanup", which being later would beat the true exception).
    // Anchoring on the last `File "…"` frame is what makes forward-first
    // correct for a CHAINED traceback too: the final block's frames come last,
    // so the first match after them is the FINAL raised exception.
    // 41st-round catch (glm, low), DECLINED on both halves; RE-RAISED and
    // declined again in the 48th (openai, medium, "identify it structurally" —
    // which is what this branch already does). The proposed fallback
    // `lines.slice(lastFrame + 1).at(-1) ?? lines.at(-1)` is a provable NO-OP:
    // the slice always runs to the END of `lines`, so its `.at(-1)` IS the
    // global last line — pinned by a test that passes IDENTICALLY either way.
    // The only real change, dropping the Capitalized requirement, re-opens the
    // 36th/37th-round bugs: forward-first-match would then accept an ordinary
    // source line (`return`, `self.x`) or the cleanup line itself. PEP 8 makes
    // a lowercase exception class vanishingly rare. Re-read in the 56th (glm,
    // low, "none required"), 77th, 78th + 80th (glm, low, "already pinned; a
    // follow-up") incl. the converse - an ordinary Capitalized header after the
    // last frame - a bounded, sanitized one-liner either way.
    // 44th-round catch (glm, low), DECLINED on both narrowings. Requiring a
    // `:` drops every BARE exception (`KeyboardInterrupt`). Requiring ADJACENCY
    // to the last frame is worse: the line after `File "…"` is the frame's
    // SOURCE line, so a real exception is never adjacent. A bare `Done` wins
    // only when the traceback carries no exception line at all.
    const lastFrame = lines.map((line) => line.startsWith('File "')).lastIndexOf(true);
    const raised = lines.slice(lastFrame + 1).find((line) => PY_EXCEPTION_LINE.test(line));
    return sanitizeProofText(raised ?? lines[lines.length - 1], maxLen);
  }
  const errorLine = [...lines].reverse().find((line) => ERROR_MARKER.test(line) && !LOG_POINTER_LINE.test(line) && !ZERO_COUNT_LINE.test(line));
  return sanitizeProofText(errorLine ?? lines[lines.length - 1], maxLen);
}

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
