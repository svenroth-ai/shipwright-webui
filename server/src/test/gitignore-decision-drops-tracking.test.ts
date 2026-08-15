/**
 * Regression guard for trg-a429ac3e (systemic root: trg-2b1db6b3).
 *
 * `.gitignore` used to carry a blanket rule,
 * `/.shipwright/agent_docs/decision-drops/`, retracted from the Shipwright
 * template on 2026-08-08. Left in place, it silently loses every future
 * iterate ADR: the drop write lands in a gitignored path, F6's `git add`
 * skips it, and `git worktree remove` destroys the untracked file with no
 * warning. This repo already lost work to it once (the iterate that found
 * this had to `git add -f` its own drop to keep it).
 *
 * `git check-ignore` (not text-matching the file) is the source of truth
 * here, so a reformatted-but-equivalent `.gitignore` can't fool this guard.
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../");

/** true = git ignores the path, false = git tracks/would-track it. */
function isIgnored(relativePath: string): boolean {
  const result = spawnSync("git", ["check-ignore", "-q", relativePath], {
    cwd: repoRoot,
  });
  return result.status === 0;
}

describe("decision-drop ADRs stay trackable", () => {
  it("does not ignore a new decision-drop file", () => {
    expect(
      isIgnored(
        ".shipwright/agent_docs/decision-drops/iterate-2026-08-15-gitignore-decision-drops_001.json",
      ),
    ).toBe(false);
  });

  it("still ignores the generated INDEX.md", () => {
    expect(isIgnored(".shipwright/agent_docs/decision-drops/INDEX.md")).toBe(true);
  });

  it("still ignores *.tmp scratch files in decision-drops", () => {
    expect(isIgnored(".shipwright/agent_docs/decision-drops/some-write.tmp")).toBe(true);
  });
});
