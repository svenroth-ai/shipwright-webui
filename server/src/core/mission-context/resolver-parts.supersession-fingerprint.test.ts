/*
 * resolver-parts.supersession-fingerprint.test.ts — the supersession memo's
 * content fingerprint must be collision-resistant (iterate-2026-08-31-
 * mission-feed-gaps, external code review, openai MEDIUM).
 *
 * The original fingerprint was `${transcript.length}:${transcript.slice(-256)}`
 * — two distinct bounded transcript snapshots sharing length and final 256
 * characters, but differing EARLIER in the tail (exactly where an earlier
 * `Run-ID:` footer would sit), would collide and replay a stale memoized
 * answer instead of re-scanning. Fixed to a full-content SHA-256.
 *
 * @covers FR-01.66
 */

import { describe, expect, it } from "vitest";

import { _clearSupersessionMemo, markSupersessionResult, supersessionMemoHit } from "./resolver-parts.js";

const UUID = "3c9e3e11-4b53-424e-8062-f9f5a24f6b68";
const ASSOCIATION_RUN_ID = "iterate-2026-07-01-stale";

describe("supersession memo — content fingerprint collision resistance", () => {
  it(
    "a memoized result for one transcript is NOT served for a different transcript that " +
      "shares length and final 256 characters but differs earlier in the tail",
    () => {
      _clearSupersessionMemo();

      const tail = "x".repeat(300); // shared suffix, well over the old 256-char window
      // Same total length, same last-256 chars — differ only in the first 41
      // characters, exactly where an EARLIER Run-ID footer would sit.
      const transcriptA = `Run-ID: iterate-2026-07-20-recovered-a\n${tail}`;
      const transcriptB = `Run-ID: iterate-2026-07-20-recovered-b\n${tail}`;
      expect(transcriptA.length).toBe(transcriptB.length);
      expect(transcriptA.slice(-256)).toBe(transcriptB.slice(-256));
      expect(transcriptA).not.toBe(transcriptB);

      markSupersessionResult(UUID, ASSOCIATION_RUN_ID, transcriptA, "iterate-2026-07-20-recovered-a");

      // The memo answers for the EXACT content it was recorded against...
      expect(supersessionMemoHit(UUID, ASSOCIATION_RUN_ID, transcriptA)).toBe(
        "iterate-2026-07-20-recovered-a",
      );
      // ...and must NOT answer for the different content that happens to
      // share length + suffix. Under the old length+suffix fingerprint this
      // would incorrectly return "iterate-2026-07-20-recovered-a" here too —
      // replaying a stale answer for genuinely different transcript content
      // instead of triggering a fresh scan.
      expect(supersessionMemoHit(UUID, ASSOCIATION_RUN_ID, transcriptB)).toBeUndefined();
    },
  );

  it("still hits for byte-for-byte identical content (the memo's actual purpose)", () => {
    _clearSupersessionMemo();
    const transcript = `Run-ID: iterate-2026-07-20-recovered\n${"x".repeat(500)}`;
    markSupersessionResult(UUID, ASSOCIATION_RUN_ID, transcript, "iterate-2026-07-20-recovered");
    expect(supersessionMemoHit(UUID, ASSOCIATION_RUN_ID, transcript)).toBe(
      "iterate-2026-07-20-recovered",
    );
  });

  it("misses when only the association key differs, even for identical transcript content", () => {
    _clearSupersessionMemo();
    const transcript = `Run-ID: iterate-2026-07-20-recovered\n${"x".repeat(500)}`;
    markSupersessionResult(UUID, "iterate-2026-06-01-one-stale-run", transcript, "iterate-2026-07-20-recovered");
    expect(supersessionMemoHit(UUID, "iterate-2026-06-15-a-different-stale-run", transcript)).toBeUndefined();
  });
});
