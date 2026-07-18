/*
 * core/mission-context/merge-check.ts — squash-aware merge detection
 * (CONTRACT §5.3). "Delivered" is a REAL observation, not a guess.
 *
 * THIS FILE IS THE COMMAND-INJECTION SURFACE both external reviews (Gemini +
 * GPT) flagged. The PR number originates in a TRANSCRIPT MARKER — attacker-
 * influenced data. Three rules, all enforced here:
 *
 *   1. The PR number is validated as a BOUNDED INTEGER (`/^\d+$/`, 1..1e7)
 *      BEFORE it is used for anything. A non-numeric marker is dropped, never
 *      passed along "just to be safe downstream".
 *   2. git runs via an ARGUMENT ARRAY with `shell: false`. There is no command
 *      string anywhere in this module — nothing to escape, nothing to inject.
 *   3. The check is SQUASH-AWARE. `--is-ancestor` is WRONG: webui is
 *      squash-only, so the branch SHA never becomes an ancestor of main. The
 *      squash commit's message carries `(#NNN)`, so that is what we grep. And
 *      we check `origin/main` — local `main` may lag the squash, which would
 *      report a false "pending" until the user happens to fetch.
 *
 * Caching is ASYMMETRIC on purpose: `merged` is terminal and cached
 * indefinitely; `pending` re-checks on a finite TTL (never cache pending
 * forever — that would freeze the UI on a stale answer forever).
 */

import { execFileSync } from "node:child_process";

import type { MergeState } from "./types.js";
import type { GitRunner } from "./worktree-roots.js";

/** Upper bound on a plausible PR number — bounds the input, not just its shape. */
const MAX_PR_NUMBER = 10_000_000;

/**
 * Validate a transcript-derived PR number. Accepts ONLY a run of ASCII digits
 * with no sign, whitespace, separator or leading `+`; rejects 0 and anything
 * above the bound. Returns null for everything else — the caller then reports
 * `unknown`, never an unchecked value.
 */
export function validatePrNumber(v: unknown): number | null {
  const s = typeof v === "number" && Number.isInteger(v) ? String(v) : v;
  if (typeof s !== "string") return null;
  if (!/^\d+$/.test(s)) return null;
  const n = Number.parseInt(s, 10);
  if (!Number.isSafeInteger(n) || n <= 0 || n > MAX_PR_NUMBER) return null;
  return n;
}

const defaultGit: GitRunner = (args, cwd) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    timeout: 8000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });

interface CacheEntry {
  state: MergeState;
  /** `null` = never expires (a merge is terminal). */
  expiresAt: number | null;
}

const cache = new Map<string, CacheEntry>();
const PENDING_TTL_MS = 60_000;
const CACHE_CAP = 512;

export interface MergeCheckDeps {
  git?: GitRunner;
  now?: () => number;
  pendingTtlMs?: number;
  /** Default branch ref to check. Overridden in tests with a real fixture repo. */
  ref?: string;
}

/**
 * Is the PR's squash commit present on `origin/main`?
 *
 * `git log <ref> --grep=(#NNN) --fixed-strings -n 1 --format=%H` — every token
 * is a separate argv member. `--fixed-strings` keeps the needle a literal so a
 * PR number can never be read as a regex (belt-and-braces: it is already
 * digits-only by the time it gets here).
 *
 * Returns `unknown` — never `pending` — when the check could not run at all
 * (no PR number, git missing, ref absent). "We could not check" and "we
 * checked and it is not there" are different facts and the UI shows them
 * differently.
 */
export function checkSquashMerged(
  projectRoot: string,
  prNumber: unknown,
  deps: MergeCheckDeps = {},
): MergeState {
  const pr = validatePrNumber(prNumber);
  if (pr == null) return "unknown";

  const git = deps.git ?? defaultGit;
  const now = deps.now ?? Date.now;
  const ttl = deps.pendingTtlMs ?? PENDING_TTL_MS;
  const ref = deps.ref ?? "origin/main";

  const key = `${projectRoot}::${ref}::${pr}`;
  const hit = cache.get(key);
  if (hit && (hit.expiresAt === null || hit.expiresAt > now())) return hit.state;

  let state: MergeState;
  try {
    // `--grep` matches anywhere in the message, so it alone false-positives
    // when an UNRELATED squash merely mentions this PR number ("follow-up to
    // (#123)"). This repo has that shape in its own history. So the grep is
    // only a cheap prefilter: we ask for SUBJECT lines (%s) and then require
    // one to END with the marker, which is where the squash suffix actually
    // lives. `-n 20` bounds the candidate set.
    const out = git(
      ["log", ref, `--grep=(#${pr})`, "--fixed-strings", "-n", "20", "--format=%s"],
      projectRoot,
    );
    const marker = `(#${pr})`;
    const merged = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .some((subject) => subject.endsWith(marker));
    state = merged ? "merged" : "pending";
  } catch {
    // git missing, not a repo, or `origin/main` absent (never fetched) — we
    // genuinely do not know. Do NOT claim "pending": that reads as "checked".
    state = "unknown";
  }

  if (cache.size >= CACHE_CAP) cache.clear();
  cache.set(key, {
    state,
    // Merged is terminal — cache forever. Pending/unknown re-check on TTL.
    expiresAt: state === "merged" ? null : now() + ttl,
  });
  return state;
}

/** Test-only: drop the module-level cache between cases. */
export function _clearMergeCache(): void {
  cache.clear();
}

/**
 * Extract the LAST `pr-link` PR number from a raw JSONL transcript slice.
 *
 * The transcript is read SERVER-SIDE from webui's own authoritative source —
 * the client never supplies it (CONTRACT §5.1 input trust boundary). The value
 * found here is still untrusted DATA: it is handed straight to
 * `validatePrNumber` and is never interpolated anywhere.
 *
 * Matches the github PR url shape rather than a bare number so an arbitrary
 * `#123` in prose cannot be mistaken for a delivery marker.
 */
const PR_URL_IN_TEXT =
  /https:\/\/github\.com\/[A-Za-z0-9._-]{1,64}\/[A-Za-z0-9._-]{1,64}\/pull\/(\d{1,8})\b/g;

export interface PrMarker {
  number: number;
  url: string;
}

export function extractPrMarker(transcript: string): PrMarker | null {
  if (!transcript) return null;
  let last: PrMarker | null = null;
  PR_URL_IN_TEXT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PR_URL_IN_TEXT.exec(transcript)) !== null) {
    const n = validatePrNumber(m[1]);
    if (n != null) last = { number: n, url: m[0] };
  }
  return last;
}
