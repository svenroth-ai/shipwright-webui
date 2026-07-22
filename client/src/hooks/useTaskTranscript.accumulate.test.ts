/*
 * iterate-2026-07-22-transcript-cursor-single-walk — the FOLD (AC-1..AC-3).
 *
 * `accumulate` is pure and exported on purpose: the fold IS the cursor
 * protocol, and pinning it without a poller wrapped around it is the difference
 * between testing the rule and testing the plumbing. The poller-level cases —
 * that the cursor actually rides on the request, and that resets rewind it —
 * live in `useTaskTranscript.cursor.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { accumulate } from "./useTaskTranscript";
import type { TranscriptChunk } from "../lib/externalApi";

function chunkAt(
  fromByte: number,
  toByte: number,
  content: string,
  fingerprint = "fp",
): TranscriptChunk {
  return { fingerprint, size: toByte, fromByte, toByte, content };
}

const EMPTY = { content: "", cursor: 0, modelName: null };

describe("accumulate — replace vs append (AC-1, AC-2)", () => {
  it("fromByte 0 REPLACES: it is an authoritative whole-file snapshot", () => {
    const prev = { content: "stale\n", cursor: 6, modelName: "old" };
    const { next, accepted } = accumulate(prev, chunkAt(0, 4, "new\n"));
    expect(accepted).toBe(true);
    expect(next.content).toBe("new\n");
    expect(next.cursor).toBe(4);
  });

  it("fromByte === cursor APPENDS and advances the cursor to toByte", () => {
    const first = accumulate(EMPTY, chunkAt(0, 4, "a\nb\n"));
    expect(first.next.cursor).toBe(4);
    const second = accumulate(first.next, chunkAt(4, 8, "c\nd\n"));
    expect(second.accepted).toBe(true);
    expect(second.next.content).toBe("a\nb\nc\nd\n");
    expect(second.next.cursor).toBe(8);
  });

  it("an empty delta at the cursor is a no-op that preserves the content BY VALUE", () => {
    const prev = { content: "a\n", cursor: 2, modelName: "m" };
    const { next, accepted } = accumulate(prev, chunkAt(2, 2, ""));
    expect(accepted).toBe(true);
    expect(next.cursor).toBe(2);
    // Equal by value is what matters: the downstream
    // `useMemo([transcript.content])` skips a full re-parse on an idle tick
    // only because the string compares equal, and that is the whole idle win.
    expect(next.content).toBe(prev.content);
  });

  it("a chunk at neither 0 nor the cursor is REJECTED without corrupting the pane", () => {
    const prev = { content: "a\nb\n", cursor: 4, modelName: "m" };
    // A duplicate, an out-of-order arrival, or a cursor the server clamped.
    const { next, accepted } = accumulate(prev, chunkAt(999, 1003, "junk\n"));
    expect(accepted).toBe(false);
    // Nothing spliced in at the wrong offset...
    expect(next.content).toBe("a\nb\n");
    expect(next.modelName).toBe("m");
    // ...and the cursor rewinds, so the next poll refetches whole and re-syncs.
    expect(next.cursor).toBe(0);
  });

  it("applying the SAME delta twice appends it once (external review, openai #1)", () => {
    const dup = chunkAt(4, 8, "c\nd\n");
    const once = accumulate({ content: "a\nb\n", cursor: 4, modelName: null }, dup);
    const twice = accumulate(once.next, dup);
    expect(once.next.content).toBe("a\nb\nc\nd\n");
    expect(twice.accepted).toBe(false);
    expect(twice.next.content).toBe("a\nb\nc\nd\n");
  });

  it("the cursor is BYTES, not string length — multi-byte UTF-8 still appends", () => {
    // "héllo\n" is 6 UTF-16 code units but 7 bytes. The external plan review
    // (gemini) proposed guarding the append with `prev.length === fromByte`.
    // That passes on ASCII fixtures and desyncs on the first accented
    // character in a real transcript — which is why the cursor is carried
    // explicitly instead of derived from the accumulated content.
    const text = "héllo\n";
    expect(text.length).toBe(6);
    expect(new TextEncoder().encode(text).length).toBe(7);

    const first = accumulate(EMPTY, chunkAt(0, 7, text));
    expect(first.next.cursor).toBe(7);
    const second = accumulate(first.next, chunkAt(7, 10, "ok\n"));
    expect(second.accepted).toBe(true);
    expect(second.next.content).toBe("héllo\nok\n");
  });
});

describe("accumulate — modelName (AC-3)", () => {
  it("a delta WITHOUT a model keeps the previously seen one", () => {
    const prev = { content: '{"model":"opus"}\n', cursor: 17, modelName: "opus" };
    const { next } = accumulate(prev, chunkAt(17, 33, '{"type":"user"}\n'));
    expect(next.modelName).toBe("opus");
  });

  it("a delta WITH a model overrides it — last occurrence wins", () => {
    const prev = { content: "x\n", cursor: 2, modelName: "opus" };
    const { next } = accumulate(prev, chunkAt(2, 33, '{"model":"a"}\n{"model":"haiku"}\n'));
    expect(next.modelName).toBe("haiku");
  });

  it("a REPLACE with no model CLEARS it — a snapshot is authoritative", () => {
    // External plan review, openai #2: `extractModelName(delta) ?? previous`
    // applied to a fromByte-0 response retains the OLD transcript's model after
    // a rotation or a task switch. That is exactly the leak AC-3 forbids, and
    // the first draft of this rule would have shipped it.
    const prev = { content: '{"model":"opus"}\n', cursor: 17, modelName: "opus" };
    const { next } = accumulate(prev, chunkAt(0, 16, '{"type":"user"}\n'));
    expect(next.modelName).toBeNull();
  });

  it("a REJECTED chunk leaves the model untouched", () => {
    const prev = { content: "x\n", cursor: 2, modelName: "opus" };
    const { next } = accumulate(prev, chunkAt(500, 519, '{"model":"other"}\n'));
    expect(next.modelName).toBe("opus");
  });
});
