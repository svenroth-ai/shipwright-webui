/*
 * merge-check.race.test.ts — the ASYNC terminal-regression guard
 * (external code review, openai MEDIUM).
 *
 * Once `checkSquashMerged` awaits git, two concurrent misses for the same PR can
 * spawn and resolve out of order. `merged` is TERMINAL (CONTRACT §5.3, cached
 * forever) and must never regress: a later `pending` from one racing spawn must
 * not clobber a `merged` the other already recorded. This pins that guard
 * deterministically by interleaving a merged-resolving check INSIDE the pending
 * one's await.
 *
 * @covers FR-01.66
 */

import { beforeEach, describe, expect, it } from "vitest";

import { _clearMergeCache, checkSquashMerged } from "./merge-check.js";

describe("checkSquashMerged async terminal-regression guard", () => {
  beforeEach(() => _clearMergeCache());

  it("a racing `pending` never regresses an already-`merged` terminal entry", async () => {
    const now = () => 1_000;
    let phase = 0;
    // First invocation resolves `pending` (empty log), but DURING its await a
    // second invocation resolves `merged` and populates the cache. Without the
    // guard the first would then clobber the terminal `merged` back to
    // `pending`; with it, the terminal result wins.
    const git = async (): Promise<string> => {
      phase++;
      if (phase === 1) {
        await checkSquashMerged("/race", 42, { git: async () => "feat: x (#42)\n", now });
        return ""; // our own answer is `pending`
      }
      return "feat: x (#42)\n";
    };

    expect(await checkSquashMerged("/race", 42, { git, now })).toBe("merged");
  });
});
