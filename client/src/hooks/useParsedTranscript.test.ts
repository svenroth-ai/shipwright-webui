/*
 * useParsedTranscript — hook-level behaviour (iterate-2026-07-23-transcript-
 * incremental-render). The parsing correctness lives in
 * incremental-session-parse.test.ts; here we prove the ref-memo wrapper:
 *   - growing content stays byte-identical to the batch parser,
 *   - an unchanged re-render returns the SAME result reference,
 *   - it survives StrictMode's double-invocation without double-appending.
 */

import { describe, it, expect } from "vitest";
import { StrictMode } from "react";
import { renderHook } from "@testing-library/react";

import { useParsedTranscript } from "./useParsedTranscript";
import { parseSessionJsonl } from "../external/session-parser";

const SESSION = "86832cb1-db18-4cb8-8755-db8dc94b6fbf";
const LINES = [
  JSON.stringify({ type: "user", sessionId: SESSION, uuid: "u-1", message: { content: "one" } }),
  JSON.stringify({ type: "assistant", sessionId: SESSION, uuid: "u-2", message: { content: [{ type: "text", text: "two" }] } }),
  JSON.stringify({ type: "user", sessionId: SESSION, uuid: "u-3", message: { content: "three" } }),
];
const snap = (k: number) => LINES.slice(0, k).join("\n") + "\n";

describe("useParsedTranscript", () => {
  it("returns the batch-parser result as content grows", () => {
    const { result, rerender } = renderHook(({ c }) => useParsedTranscript(c), {
      initialProps: { c: snap(1) },
    });
    expect(result.current).toEqual(parseSessionJsonl(snap(1)));

    rerender({ c: snap(2) });
    expect(result.current).toEqual(parseSessionJsonl(snap(2)));

    rerender({ c: snap(3) });
    expect(result.current).toEqual(parseSessionJsonl(snap(3)));
  });

  it("returns the SAME result reference when content is unchanged", () => {
    const { result, rerender } = renderHook(({ c }) => useParsedTranscript(c), {
      initialProps: { c: snap(2) },
    });
    const first = result.current;
    rerender({ c: snap(2) });
    expect(result.current).toBe(first);
  });

  it("is correct under StrictMode double-render (no double-append)", () => {
    const { result, rerender } = renderHook(({ c }) => useParsedTranscript(c), {
      wrapper: StrictMode,
      initialProps: { c: snap(1) },
    });
    rerender({ c: snap(2) });
    rerender({ c: snap(3) });
    expect(result.current).toEqual(parseSessionJsonl(snap(3)));
    expect(result.current.events).toHaveLength(3);
  });
});
