/*
 * core/mission-context/tests-diff.ts — the Tests BASELINE-DIFF (CONTRACT
 * §10 Slice-2, campaign 2026-07-18-mission-artifacts).
 *
 * The contract asks for "the manifest at iterate start vs. finalize (and/or the
 * git diff of test files)". The WebUI is a read-only OBSERVER (Architecture
 * rule 4, DO-NOT #1) — it is never running when an iterate starts, so it cannot
 * capture a start-of-run snapshot. The git diff of the run's own commit IS the
 * baseline diff, and it is authoritative rather than reconstructed:
 *
 *   git show --name-status <commit>   →  A / M / D per file
 *
 * `D` is exactly the AC2 case — "its manifest entry no longer exists". A removed
 * test cannot be found by inspecting the current manifest (that is the whole
 * point of a removal), so the diff is the ONLY source that can classify it.
 *
 * git runs as an ARGUMENT ARRAY with `shell: false` (never a command string),
 * and the commit is hex-validated BEFORE it becomes an argument, so a recorded
 * sha cannot smuggle a flag (`--upload-pack=…`) or a pathspec.
 */

import type { GitRunner } from "./worktree-roots.js";
import type { TestChangeKind } from "./types-slice2.js";

export interface ChangedTestFile {
  /** POSIX-style repo-relative path. Display-safe: inside the repo by definition. */
  path: string;
  kind: TestChangeKind;
}

export type TestsDiff =
  | { status: "ok"; files: ChangedTestFile[]; truncated: boolean }
  | { status: "unavailable"; reason: "bad_commit" | "git_failed" };

/** Bound a pathological commit — a tree-wide rewrite must not be unbounded. */
const MAX_DIFF_TOKENS = 40_000;

/**
 * Bound what we KEEP. Beyond this the caller reports truncation honestly.
 *
 * CALIBRATED, not guessed (external plan review, HIGH #3). Measured over this
 * repo's last 60 commits: the median commit touches 0 test files, the 95th
 * percentile touches 13, and the two largest — both campaign-scale sweeps, incl.
 * the #289 traceability retrofit that re-tagged every suite — touch 77 and 116.
 * A cap of 50 would therefore have truncated REAL commits, which is why the
 * first guess was wrong. 500 leaves >4x headroom over the largest observed
 * commit while keeping the response bounded (~100 KB worst case), so a
 * paginated endpoint would add an access-controlled surface for a case the
 * history does not contain. Truncation is still REPORTED if it ever happens.
 */
export const MAX_TEST_FILES = 500;

/** A recorded sha is untrusted input until it matches this. */
const SHA_RE = /^[0-9a-f]{7,40}$/i;

/**
 * Is this path a test file? Deliberately conservative — a false positive would
 * put a production file in the Tests artifact and misreport the run.
 *
 * Covers this repo's two real conventions: co-located `*.test.ts(x)` (vitest)
 * and `client/e2e/**\/*.spec.ts` (Playwright).
 */
export function isTestFile(p: string): boolean {
  const f = p.toLowerCase();
  if (/\.(test|spec)\.(ts|tsx|js|jsx|mts|cts)$/.test(f)) return true;
  // A helper/fixture inside an e2e tree is part of the test surface too.
  return /(^|\/)e2e\//.test(f) && /\.(ts|tsx)$/.test(f);
}

/**
 * Layer for a file the manifest does not know (the `removed` case always lands
 * here — the entry is gone). Returns null rather than guessing when the path
 * carries no signal: an honest unknown beats an invented layer.
 */
export function inferLayer(p: string): string | null {
  const f = p.toLowerCase();
  if (/(^|\/)e2e\//.test(f) || /\.spec\.(ts|tsx|js|jsx)$/.test(f)) return "e2e";
  if (/\.test\.(ts|tsx|js|jsx|mts|cts)$/.test(f)) return "unit";
  return null;
}

function classify(status: string): TestChangeKind | null {
  const c = status[0]?.toUpperCase();
  if (c === "A") return "added";
  if (c === "D") return "removed";
  // M (modified), T (type change), and — with `--no-renames` off, defensively —
  // R/C are all "this file changed" from a reader's point of view.
  if (c === "M" || c === "T" || c === "R" || c === "C") return "modified";
  return null;
}

/**
 * Parse `git show --name-status -z` output into changed TEST files only.
 *
 * NUL-DELIMITED, not line-based (external plan review, MEDIUM #6). A git path
 * may contain a tab, a quote, a newline or arbitrary Unicode; with `-z` git
 * emits the RAW bytes as `<status>NUL<path>NUL…` and performs no quoting, so
 * splitting on NUL is exact. Line-splitting would mis-parse such a path — and
 * silently, which is the worst way for a test-reporting feature to fail.
 *
 * Exported for direct unit testing: the parser is where the real logic lives,
 * and testing it through a git double would only test the double.
 */
export function parseNameStatus(out: string): { files: ChangedTestFile[]; truncated: boolean } {
  const files: ChangedTestFile[] = [];
  const seen = new Set<string>();
  const tokens = out.split("\0");
  let truncated = false;

  for (let i = 0; i + 1 < tokens.length; i += 2) {
    if (i >= MAX_DIFF_TOKENS) {
      truncated = true;
      break;
    }
    // Tokens alternate status, path. A stray empty token (trailing NUL) is
    // skipped by re-syncing on the next non-empty status token.
    const status = tokens[i];
    if (!status) {
      i -= 1; // re-align: consume one token instead of two
      continue;
    }
    const kind = classify(status);
    const p = tokens[i + 1]?.replace(/\\/g, "/").trim();
    if (!kind || !p || !isTestFile(p) || seen.has(p)) continue;
    if (files.length >= MAX_TEST_FILES) {
      truncated = true;
      break;
    }
    seen.add(p);
    files.push({ path: p, kind });
  }

  return { files, truncated };
}

/**
 * Which test files this run's commit changed.
 *
 * `unavailable` is returned when git could not answer — NEVER an empty `ok`.
 * Reporting "no tests changed" because git failed is precisely the false
 * negative this feature must not produce.
 */
export function readChangedTestFiles(
  projectRoot: string,
  commit: string | null,
  git: GitRunner,
): TestsDiff {
  if (!commit || !SHA_RE.test(commit)) return { status: "unavailable", reason: "bad_commit" };

  let out: string;
  try {
    out = git(
      // `-z` — raw NUL-delimited paths, so a path containing a tab/newline/
      // quote cannot be mis-parsed. `--first-parent` keeps a merge commit
      // meaningful instead of silently empty.
      ["show", "--name-status", "--format=", "--no-renames", "--first-parent", "-z", commit, "--"],
      projectRoot,
    );
  } catch {
    // Commit not in this repo (a sibling clone's sha), git missing, timeout.
    return { status: "unavailable", reason: "git_failed" };
  }

  return { status: "ok", ...parseNameStatus(out) };
}
