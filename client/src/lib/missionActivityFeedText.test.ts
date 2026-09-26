/*
 * Direct unit coverage for `stripDuplicateSentence` — split out of the
 * component-level tests in `MissionActivityFeed.test.tsx` because the local
 * PR-review preflight (BLOCK, 2026-09-26) found the matcher had no sentence-
 * boundary anchoring: it stripped the duplicate's words wherever they
 * appeared, including mid-sentence inside genuine narration.
 */
import { describe, expect, it } from "vitest";
import { stripDuplicateSentence } from "./missionActivityFeedText";

const DUPLICATE = 'Merged as "fix(mission): real content".';

describe("stripDuplicateSentence", () => {
  it("returns an empty string when the whole text is the duplicate", () => {
    expect(stripDuplicateSentence(DUPLICATE, DUPLICATE)).toBe("");
  });

  it("strips an embedded duplicate sentence at the end of a longer narrative", () => {
    const text = `Investigated the flaky test. ${DUPLICATE}`;
    expect(stripDuplicateSentence(text, DUPLICATE)).toBe("Investigated the flaky test.");
  });

  it("strips an embedded duplicate sentence at the start, keeping what follows", () => {
    const text = `${DUPLICATE} Also cleaned up two stale branches.`;
    expect(stripDuplicateSentence(text, DUPLICATE)).toBe("Also cleaned up two stale branches.");
  });

  // The BLOCK finding: the duplicate's words appear mid-sentence, not as
  // their own sentence — must be left fully intact, not partially cut.
  it("leaves genuine narration untouched when the duplicate's words appear mid-sentence", () => {
    const text = `The commit message reads: ${DUPLICATE}`;
    expect(stripDuplicateSentence(text, DUPLICATE)).toBe(text);
  });

  it("returns text unchanged when the duplicate does not appear at all", () => {
    const text = "Nothing here matches the PR title.";
    expect(stripDuplicateSentence(text, DUPLICATE)).toBe(text);
  });

  it("returns text unchanged when duplicate is null/undefined", () => {
    expect(stripDuplicateSentence("Some text.", null)).toBe("Some text.");
    expect(stripDuplicateSentence("Some text.", undefined)).toBe("Some text.");
  });
});
