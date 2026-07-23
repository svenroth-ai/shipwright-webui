import { useRef } from "react";

import {
  EMPTY_INCREMENTAL_PARSE,
  advanceIncrementalParse,
  type IncrementalParseState,
} from "../external/incremental-session-parse";
import type { ParseResult } from "../external/session-parser";

/**
 * Parse the accumulated transcript `content` incrementally
 * (iterate-2026-07-23-transcript-incremental-render). Each render parses only
 * the bytes appended since the last one and reuses the events it already
 * produced; an idle poll (unchanged `content`) returns the SAME `ParseResult`
 * reference so downstream memos do not churn.
 *
 * The state lives in a ref updated during render — the standard "previous
 * value" memoization pattern. It is safe under StrictMode's double render
 * because `advanceIncrementalParse` is pure and idempotent for a given
 * `content`: the second invocation sees `content === state.content` and returns
 * the cached state unchanged.
 */
export function useParsedTranscript(content: string): ParseResult {
  const stateRef = useRef<IncrementalParseState>(EMPTY_INCREMENTAL_PARSE);
  const next = advanceIncrementalParse(stateRef.current, content);
  stateRef.current = next;
  return next.result;
}
