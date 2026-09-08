/*
 * merge-check.squash.test.ts — squash-aware merge detection over a REAL
 * git repo. Split out of `merge-check.test.ts` (CLAUDE.md 300-line rule),
 * following the same per-aspect split as the sibling `merge-check.origin.test.ts`
 * / `merge-check.race.test.ts`.
 *
 * CONTRACT §11 requires a real minimal git repo here, not a mocked `git log`:
 * the whole point of §5.3 is that the squash commit's MESSAGE is the only
 * evidence of a merge, and a mock would happily agree with a wrong query.
 * The fixture creates a real `refs/remotes/origin/main` so the DEFAULT ref
 * path (`origin/main`, not local `main`) is what is actually exercised.
 *
 * @covers FR-01.66
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _clearMergeCache, checkSquashMerged } from "./merge-check.js";

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

// @covers FR-01.66
describe.runIf(gitAvailable)("checkSquashMerged (real repo)", () => {
  let repo: string | null = null;

  beforeEach(() => {
    _clearMergeCache();
  });

  afterEach(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
    repo = null;
  });

  it("detects the squash commit by its (#NNN) message on origin/main", async () => {
    repo = makeRepoWithSquash(4242);
    expect(await checkSquashMerged(repo, 4242)).toBe("merged");
  });

  it("reports `pending` when no squash commit carries that PR number", async () => {
    repo = makeRepoWithSquash(4242);
    expect(await checkSquashMerged(repo, 999)).toBe("pending");
  });

  it("is SQUASH-aware: the branch SHA is not an ancestor, yet the merge is found", async () => {
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
    expect(await checkSquashMerged(repo, 4242)).toBe("merged"); // the right one holds
  });

  it("returns `unknown` (not pending) when origin/main does not exist", async () => {
    repo = mkdtempSync(join(tmpdir(), "mc-merge-bare-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "Test"]);
    writeFileSync(join(repo, "a.txt"), "one");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "chore: init"]);
    expect(await checkSquashMerged(repo, 1)).toBe("unknown");
  });

  it("returns `unknown` for an unvalidatable PR number without invoking git", async () => {
    repo = makeRepoWithSquash(4242);
    let called = false;
    const state = await checkSquashMerged(repo, "4242; rm -rf /", {
      git: () => {
        called = true;
        return "";
      },
    });
    expect(state).toBe("unknown");
    expect(called).toBe(false); // the gate short-circuits BEFORE git
  });

  it("passes the PR number as a separate argv member, never a command string", async () => {
    repo = makeRepoWithSquash(4242);
    let seen: string[] = [];
    await checkSquashMerged(repo, 4242, {
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

/*
 * External plan review (gemini, 2026-07-18) — `--grep` matches ANYWHERE in the
 * commit message, so an unrelated squash that merely MENTIONS a PR number
 * would report a false "merged". The subject-suffix check is the fix.
 */
// @covers FR-01.66
describe.runIf(gitAvailable)("merge false-positive guard", () => {
  let repo: string | null = null;

  beforeEach(() => _clearMergeCache());
  afterEach(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
    repo = null;
  });

  it("does NOT report merged when another PR's squash merely mentions the number", async () => {
    repo = mkdtempSync(join(tmpdir(), "mc-merge-fp-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "Test"]);
    writeFileSync(join(repo, "a.txt"), "one");
    git(repo, ["add", "."]);
    // PR #500 is only REFERENCED here; the commit actually delivers #501.
    git(repo, ["commit", "-q", "-m", "fix: follow-up to (#500) after review (#501)"]);
    git(repo, ["update-ref", "refs/remotes/origin/main", "HEAD"]);

    expect(await checkSquashMerged(repo, 501)).toBe("merged"); // the real delivery
    _clearMergeCache();
    expect(await checkSquashMerged(repo, 500)).toBe("pending"); // the mere mention
  });

  it("matches a multi-line body without being fooled by a body mention", async () => {
    repo = mkdtempSync(join(tmpdir(), "mc-merge-body-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "Test"]);
    writeFileSync(join(repo, "a.txt"), "one");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "feat: thing (#777)\n\nSupersedes (#776).\n"]);
    git(repo, ["update-ref", "refs/remotes/origin/main", "HEAD"]);

    expect(await checkSquashMerged(repo, 777)).toBe("merged");
    _clearMergeCache();
    expect(await checkSquashMerged(repo, 776)).toBe("pending");
  });
});
