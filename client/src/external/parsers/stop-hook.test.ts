/*
 * detectStopHook unit coverage — iterate-2026-05-27-transcript-renderer-scroll AC3.
 *
 * The fingerprint mirrors the real BLOAT GATE payload observed in
 * sessionId 86832cb1 (12/12 occurrences). Covers the positive path,
 * the R1 mixed-prose falsification (external-review HIGH-2), the
 * length guard, and the malformed-banner fallback.
 */

import { describe, it, expect } from "vitest";
import { detectStopHook } from "./stop-hook";

const REAL_PAYLOAD = [
  "Stop hook feedback:",
  "================================================================",
  "  SHIPWRIGHT BLOAT GATE — Stop blocked",
  "================================================================",
  "",
  "The IRON LAW",
  "",
  "    NO COMPLETION WHILE FILES ARE GROWING UNCHECKED",
  "",
  "If a file just crossed its size limit ...",
].join("\n");

describe("detectStopHook", () => {
  it("detects a real BLOAT GATE payload and extracts the banner title", () => {
    const out = detectStopHook(REAL_PAYLOAD);
    expect(out).not.toBeNull();
    expect(out!.gateName).toBe("SHIPWRIGHT BLOAT GATE — Stop blocked");
    expect(out!.body).toBe(REAL_PAYLOAD);
  });

  it("returns null for non-string content", () => {
    expect(detectStopHook(null)).toBeNull();
    expect(detectStopHook(undefined)).toBeNull();
    expect(detectStopHook(123)).toBeNull();
    expect(detectStopHook([{ type: "text", text: REAL_PAYLOAD }])).toBeNull();
  });

  it("returns null for a normal user message", () => {
    expect(detectStopHook("Hey, can you fix the transcript renderer?")).toBeNull();
  });

  it("returns null when the prefix appears mid-string (R1 mixed-prose guard)", () => {
    // External-review HIGH-2: a `/m` regex flag would let this match at
    // the line-start of the embedded banner and swallow the prose. The
    // startsWith string-start gate rejects it.
    const mixed = [
      "Hey look at this error I got:",
      "Stop hook feedback:",
      "================================================================",
      "  SHIPWRIGHT BLOAT GATE — Stop blocked",
      "================================================================",
      "what does it mean?",
    ].join("\n");
    expect(detectStopHook(mixed)).toBeNull();
  });

  it("returns null for inputs shorter than the sanity floor", () => {
    expect(detectStopHook("Stop hook feedback:")).toBeNull();
  });

  it("returns null for inputs longer than the 16 KiB length guard", () => {
    const huge = "Stop hook feedback:\n" + "x".repeat(20000);
    expect(detectStopHook(huge)).toBeNull();
  });

  it("falls back to a default gateName when the banner shape is malformed but prefix matches", () => {
    // Prefix present, but no === banner lines. We must STILL classify
    // (returning null would leak stop-hook output into a user bubble).
    const malformed =
      "Stop hook feedback: something went wrong and there is no banner here at all today";
    const out = detectStopHook(malformed);
    expect(out).not.toBeNull();
    expect(out!.gateName).toBe("Stop hook");
    expect(out!.body).toBe(malformed);
  });

  it("uses default gateName when the banner title line is blank", () => {
    const blankTitle = [
      "Stop hook feedback:",
      "==========",
      "   ",
      "==========",
      "body text follows here to clear the length floor",
    ].join("\n");
    const out = detectStopHook(blankTitle);
    expect(out).not.toBeNull();
    expect(out!.gateName).toBe("Stop hook");
  });
});
