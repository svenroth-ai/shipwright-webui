/*
 * incremental-session-parse — the OPTIMIZATION itself, not just its output
 * (iterate-2026-07-23-transcript-incremental-render). The correctness proof in
 * incremental-session-parse.test.ts guarantees the events are byte-identical to
 * a whole-string parse; this file guarantees they are produced WITHOUT
 * re-parsing the whole string. It fails loudly if anyone reverts the renderer
 * to a full re-parse-per-poll.
 *
 * `parseSessionJsonl` is spied THROUGH to its real implementation, so the
 * incremental parser still does real work — we only observe what byte-region it
 * was handed.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("./session-parser", async (orig) => {
  const actual = await orig<typeof import("./session-parser")>();
  return { ...actual, parseSessionJsonl: vi.fn(actual.parseSessionJsonl) };
});

import { parseSessionJsonl } from "./session-parser";
import {
  EMPTY_INCREMENTAL_PARSE,
  advanceIncrementalParse,
} from "./incremental-session-parse";

const spy = vi.mocked(parseSessionJsonl);
const SESSION = "86832cb1-db18-4cb8-8755-db8dc94b6fbf";
const line = (n: number) =>
  JSON.stringify({ type: "user", sessionId: SESSION, uuid: `u-${n}`, message: { content: `msg ${n}` } });

describe("advanceIncrementalParse — parses only the delta (the actual win)", () => {
  it("on an append, hands parseSessionJsonl only the newly-appended region", () => {
    const lines: string[] = [];
    for (let i = 0; i < 500; i++) lines.push(line(i));
    const big = lines.join("\n") + "\n";
    const state = advanceIncrementalParse(EMPTY_INCREMENTAL_PARSE, big);

    spy.mockClear();
    const grown = advanceIncrementalParse(state, big + line(500) + "\n");

    // Every call this step received a region no larger than the appended line
    // — never the ~40 KB accumulated transcript.
    const maxLen = Math.max(...spy.mock.calls.map((c) => c[0].length));
    expect(maxLen).toBeLessThan(big.length / 10);
    expect(grown.result.events).toHaveLength(501);
  });

  it("does NOT call parseSessionJsonl at all on an idle poll", () => {
    const content = [line(0), line(1)].join("\n") + "\n";
    const state = advanceIncrementalParse(EMPTY_INCREMENTAL_PARSE, content);
    spy.mockClear();
    advanceIncrementalParse(state, content);
    expect(spy).not.toHaveBeenCalled();
  });
});
