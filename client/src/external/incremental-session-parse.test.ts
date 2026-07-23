/*
 * incremental-session-parse — correctness proof (iterate-2026-07-23-transcript-
 * incremental-render, AC1–AC4).
 *
 * The single load-bearing property: for ANY final `content`, feeding the
 * growing snapshots through `advanceIncrementalParse` one at a time yields, at
 * every step, a result BYTE-IDENTICAL to `parseSessionJsonl(content)` — the
 * shipped, tested batch parser. If that holds for line-by-line growth (the
 * production shape: `content` always ends on `\n`) AND for char-by-char growth
 * (which stresses the trailing-partial-line path the production stream never
 * hits but the tests must), the incremental layer changed cost, not behaviour.
 */

import { describe, it, expect } from "vitest";
import { parseSessionJsonl } from "./session-parser";
import {
  EMPTY_INCREMENTAL_PARSE,
  advanceIncrementalParse,
} from "./incremental-session-parse";

const SESSION = "86832cb1-db18-4cb8-8755-db8dc94b6fbf";

// A varied corpus mirroring shapes observed on disk, plus a deliberately
// malformed middle line so the `unknown`-stub + malformedLines accounting is
// exercised, and a non-ASCII payload so UTF-16 index handling is covered.
const CORPUS: string[] = [
  JSON.stringify({ type: "last-prompt", leafUuid: "x", sessionId: SESSION }),
  JSON.stringify({ type: "custom-title", customTitle: "Iterate", sessionId: SESSION, uuid: "u-title" }),
  JSON.stringify({ type: "user", sessionId: SESSION, uuid: "u-1", message: { content: "Hallo Wörld — 日本語 🚀" } }),
  JSON.stringify({
    type: "assistant",
    sessionId: SESSION,
    uuid: "u-2",
    message: {
      content: [
        { type: "text", text: "Working on it." },
        { type: "tool_use", id: "tool-1", name: "Bash", input: { cmd: "ls" } },
      ],
    },
  }),
  JSON.stringify({
    type: "user",
    sessionId: SESSION,
    uuid: "u-3",
    message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "file.txt" }] },
  }),
  "{ this is not valid json",
  JSON.stringify({ type: "mode", mode: "normal", sessionId: SESSION }),
  JSON.stringify({ type: "assistant", sessionId: SESSION, uuid: "u-5", message: { content: [{ type: "text", text: "Done." }] } }),
];

/** Every prefix of the joined lines, terminated by `\n` (production shape). */
function lineByLineSnapshots(lines: string[]): string[] {
  const out: string[] = [];
  for (let k = 1; k <= lines.length; k++) {
    out.push(lines.slice(0, k).join("\n") + "\n");
  }
  return out;
}

describe("advanceIncrementalParse — byte-identity to the batch parser (AC1)", () => {
  it("matches parseSessionJsonl at every line-by-line growth step", () => {
    let state = EMPTY_INCREMENTAL_PARSE;
    for (const content of lineByLineSnapshots(CORPUS)) {
      state = advanceIncrementalParse(state, content);
      expect(state.result).toEqual(parseSessionJsonl(content));
    }
  });

  it("matches parseSessionJsonl at every CHAR-by-char growth step (tail path)", () => {
    const full = CORPUS.join("\n") + "\n";
    let state = EMPTY_INCREMENTAL_PARSE;
    // Grow one code unit at a time — exercises the trailing partial line that
    // production never sees but the batch parser must still agree with.
    for (let i = 1; i <= full.length; i++) {
      const content = full.slice(0, i);
      state = advanceIncrementalParse(state, content);
      expect(state.result).toEqual(parseSessionJsonl(content));
    }
  });

  it("matches for content with NO trailing newline (all one partial line)", () => {
    const content = CORPUS[2]; // a single valid JSON object, no '\n'
    const state = advanceIncrementalParse(EMPTY_INCREMENTAL_PARSE, content);
    expect(state.result).toEqual(parseSessionJsonl(content));
  });

  it("matches for the empty string", () => {
    const state = advanceIncrementalParse(EMPTY_INCREMENTAL_PARSE, "");
    expect(state.result).toEqual(parseSessionJsonl(""));
    expect(state.result.events).toHaveLength(0);
  });
});

describe("advanceIncrementalParse — reference preservation (AC2)", () => {
  it("keeps already-parsed event objects referentially identical across an append", () => {
    const snaps = lineByLineSnapshots(CORPUS);
    const a = advanceIncrementalParse(EMPTY_INCREMENTAL_PARSE, snaps[3]); // 4 lines committed
    const b = advanceIncrementalParse(a, snaps[6]); // grew to 7 lines
    // Every event that existed in `a` is the SAME object in `b`.
    for (let i = 0; i < a.result.events.length; i++) {
      expect(b.result.events[i]).toBe(a.result.events[i]);
    }
    // …and `b` genuinely appended new ones.
    expect(b.result.events.length).toBeGreaterThan(a.result.events.length);
  });

  it("does NOT mutate the previous state's arrays", () => {
    const snaps = lineByLineSnapshots(CORPUS);
    const a = advanceIncrementalParse(EMPTY_INCREMENTAL_PARSE, snaps[3]);
    const lenBefore = a.result.events.length;
    advanceIncrementalParse(a, snaps[6]);
    expect(a.result.events.length).toBe(lenBefore);
  });
});

describe("advanceIncrementalParse — reset paths (AC3)", () => {
  const snaps = lineByLineSnapshots(CORPUS);

  it("full-reparses when content shrinks (truncation)", () => {
    const grown = advanceIncrementalParse(EMPTY_INCREMENTAL_PARSE, snaps[6]);
    const shorter = snaps[2];
    const reset = advanceIncrementalParse(grown, shorter);
    expect(reset.result).toEqual(parseSessionJsonl(shorter));
  });

  it("full-reparses when the prefix differs (rotation / replacement)", () => {
    const grown = advanceIncrementalParse(EMPTY_INCREMENTAL_PARSE, snaps[6]);
    const replaced =
      JSON.stringify({ type: "user", sessionId: "other", uuid: "z-1", message: { content: "brand new file" } }) + "\n";
    const reset = advanceIncrementalParse(grown, replaced);
    expect(reset.result).toEqual(parseSessionJsonl(replaced));
  });

  it("resets cleanly to empty then re-grows (rotation → empty → new content)", () => {
    const grown = advanceIncrementalParse(EMPTY_INCREMENTAL_PARSE, snaps[6]);
    const emptied = advanceIncrementalParse(grown, "");
    expect(emptied.result.events).toHaveLength(0);
    const regrown = advanceIncrementalParse(emptied, snaps[1]);
    expect(regrown.result).toEqual(parseSessionJsonl(snaps[1]));
  });
});

describe("advanceIncrementalParse — idle identity (AC4)", () => {
  it("returns the SAME state (and result) object when content is unchanged", () => {
    const snaps = lineByLineSnapshots(CORPUS);
    const a = advanceIncrementalParse(EMPTY_INCREMENTAL_PARSE, snaps[3]);
    const again = advanceIncrementalParse(a, snaps[3]);
    expect(again).toBe(a);
    expect(again.result).toBe(a.result);
  });
});

describe("advanceIncrementalParse — malformed line accounting", () => {
  it("preserves the batch parser's unknown-stub + malformedLines behaviour", () => {
    const content = CORPUS.join("\n") + "\n";
    const state = advanceIncrementalParse(EMPTY_INCREMENTAL_PARSE, content);
    const batch = parseSessionJsonl(content);
    expect(state.result.malformedLines).toBe(batch.malformedLines);
    expect(state.result.malformedLines).toBe(1); // exactly the one bad middle line
    // The malformed MIDDLE line surfaces as an unknown stub (never dropped).
    const stubs = state.result.events.filter(
      (e) => e.kind === "unknown" && e.originalType === "(unparseable)",
    );
    expect(stubs).toHaveLength(1);
  });
});
