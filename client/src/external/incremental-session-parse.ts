/*
 * Incremental session-JSONL parse (iterate-2026-07-23-transcript-incremental-render).
 *
 * `useTaskTranscript` delivers `transcript.content` as an APPEND-ONLY,
 * whole-line prefix of the file that always ends on `\n` (cursor-single-walk).
 * The two consumers — `BubbleTranscript` and `TaskDetailPage.transcriptStats` —
 * used to re-run `parseSessionJsonl` over the WHOLE accumulated string on every
 * poll that grew it (5.6 ms median / 11.3 ms p90 on this project's corpus).
 *
 * This module parses only the NEWLY-COMPLETED lines each step and reuses the
 * event objects it already produced, so React reconciliation sees stable
 * references for unchanged bubbles. It does not re-implement any parsing: it
 * delegates to the shipped, tested `parseSessionJsonl` on sub-regions, which
 * makes the output provably byte-identical to a whole-string parse for any
 * final `content` (see incremental-session-parse.test.ts) — and keeps the
 * bloat-frozen `session-parser.ts` untouched.
 *
 * Behaviour-preserving: same events, same `malformedLines`. Only cost changes.
 */

import {
  parseSessionJsonl,
  type ParseResult,
  type ParsedEvent,
} from "./session-parser";

export interface IncrementalParseState {
  /** The exact `content` this state was produced from. */
  readonly content: string;
  /** UTF-16 index just past the last `\n` in `content` — the boundary up to
   *  which events are fully committed and cached. */
  readonly committedLen: number;
  /** `content.slice(0, committedLen)`. A V8 sliced string, so O(1) to hold; it
   *  is the exact byte-region whose parse is cached, and the sufficient key for
   *  detecting an append (identical leading bytes ⇒ identical committed events). */
  readonly committedPrefix: string;
  /** Parsed events for the committed prefix. References are preserved across
   *  appends (only newly-completed lines mint new objects). */
  readonly committedEvents: ParsedEvent[];
  /** `malformedLines` accumulated over the committed prefix. */
  readonly committedMalformed: number;
  /** The full result for `content` = committed events plus the trailing partial
   *  line (the tail is re-parsed each step; it is always `""` in production). */
  readonly result: ParseResult;
}

const EMPTY_RESULT: ParseResult = { events: [], malformedLines: 0 };

export const EMPTY_INCREMENTAL_PARSE: IncrementalParseState = {
  content: "",
  committedLen: 0,
  committedPrefix: "",
  committedEvents: [],
  committedMalformed: 0,
  result: EMPTY_RESULT,
};

/**
 * Advance the incremental parse from `prev` to `content`. Pure: the result for
 * a given `content` is correct regardless of `prev` (a non-append falls back to
 * a full re-parse), so render ordering only affects cost, never correctness.
 */
export function advanceIncrementalParse(
  prev: IncrementalParseState,
  content: string,
): IncrementalParseState {
  // Idle poll: identical content → same state (and same result reference), so
  // downstream memos never churn.
  if (content === prev.content) return prev;

  // Append iff the new content still begins with the previously-committed
  // prefix. This is sufficient for correctness — those exact leading bytes
  // parse to those exact events — so a rotation / truncation / replacement
  // (shorter, or a differing prefix) simply fails the check and resets.
  const isAppend =
    content.length >= prev.committedLen && content.startsWith(prev.committedPrefix);

  let committedLen = isAppend ? prev.committedLen : 0;
  let committedEvents = isAppend ? prev.committedEvents : EMPTY_INCREMENTAL_PARSE.committedEvents;
  let committedMalformed = isAppend ? prev.committedMalformed : 0;

  // Parse the newly-completed lines `[committedLen, lastNewline + 1)`. The
  // region always ends on `\n`, so `parseSessionJsonl` treats every line in it
  // as a middle line — identical to how it treats those same lines inside the
  // whole string (a malformed one becomes an `unknown` stub, never dropped).
  const lastNewline = content.lastIndexOf("\n");
  const newCommittedLen = lastNewline >= 0 ? lastNewline + 1 : 0;
  if (newCommittedLen > committedLen) {
    const region = parseSessionJsonl(content.slice(committedLen, newCommittedLen));
    committedEvents =
      committedEvents.length === 0
        ? region.events
        : committedEvents.concat(region.events); // concat preserves prior refs
    committedMalformed += region.malformedLines;
    committedLen = newCommittedLen;
  }

  const committedPrefix =
    committedLen === content.length ? content : content.slice(0, committedLen);

  // The trailing partial line `[committedLen, end)` — no `\n`, so
  // `parseSessionJsonl` applies its LAST-line semantics (swallow a torn parse,
  // no stub), exactly as the whole-string parse does for the final segment.
  // Always `""` in production (`content` ends on `\n`), so this costs nothing;
  // any tail event is transient (re-parsed each step, fresh identity when it
  // later commits), which is why AC2's identity guarantee is scoped to
  // committed events. Byte identity of the events still holds either way.
  const tail = content.slice(committedLen);
  let result: ParseResult;
  if (tail.length === 0) {
    result = { events: committedEvents, malformedLines: committedMalformed };
  } else {
    const tailParsed = parseSessionJsonl(tail);
    result = {
      events:
        tailParsed.events.length === 0
          ? committedEvents
          : committedEvents.concat(tailParsed.events),
      malformedLines: committedMalformed + tailParsed.malformedLines,
    };
  }

  return { content, committedLen, committedPrefix, committedEvents, committedMalformed, result };
}
