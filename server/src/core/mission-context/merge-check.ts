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

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { MergeState } from "./types.js";
import type { GitRunner } from "./worktree-roots.js";

const execFileP = promisify(execFile);

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

const defaultGit: GitRunner = async (args, cwd) => {
  const { stdout } = await execFileP("git", args, {
    cwd,
    encoding: "utf-8",
    timeout: 8000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
};

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
export async function checkSquashMerged(
  projectRoot: string,
  prNumber: unknown,
  deps: MergeCheckDeps = {},
): Promise<MergeState> {
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
    const out = await git(
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

  // ASYNC RACE GUARD (external code review, openai MEDIUM). Now that this
  // function `await`s git, two concurrent misses for the same PR can spawn and
  // resolve out of order. `merged` is TERMINAL and must never regress, so if a
  // concurrent check already recorded it during our await, keep it — a later
  // `pending` from our own spawn must not clobber it back to non-terminal.
  const prior = cache.get(key);
  if (prior?.state === "merged") return "merged";

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
 *
 * REPO BINDING (internal code review, MEDIUM): matching any `owner/repo` and
 * keeping the LAST hit is not safe here. A shipwright session routinely cites a
 * SIBLING repo's PR (`svenroth-ai/shipwright#290`) after its own webui link,
 * and PR numbers across those two repos overlap almost completely — webui has
 * its own #290. Grepping webui's `origin/main` for a shipwright PR number would
 * render a false "Delivered". So a marker counts ONLY when its owner/repo
 * matches the project's own `origin` remote; if the remote cannot be
 * determined we return null and the merge state stays `unknown`, because
 * "delivered" must be a real observation.
 */
const PR_URL_IN_TEXT =
  /https:\/\/github\.com\/([A-Za-z0-9._-]{1,64})\/([A-Za-z0-9._-]{1,64})\/pull\/(\d{1,8})\b/g;

export interface PrMarker {
  number: number;
  url: string;
  owner: string;
  repo: string;
}

export interface RepoSlug {
  owner: string;
  repo: string;
}

/**
 * Parse `owner/repo` out of a git remote URL. Handles the https and scp-like
 * SSH forms, with or without a trailing `.git`. Returns null for anything that
 * is not a github remote — the caller then declines to verify.
 */
export function parseOriginSlug(remoteUrl: unknown): RepoSlug | null {
  if (typeof remoteUrl !== "string" || remoteUrl.length === 0 || remoteUrl.length > 512) return null;
  const url = remoteUrl.trim();
  const m =
    /^https?:\/\/(?:[^@/]+@)?github\.com\/([A-Za-z0-9._-]{1,64})\/([A-Za-z0-9._-]{1,64}?)(?:\.git)?\/?$/.exec(url) ??
    /^(?:ssh:\/\/)?git@github\.com[:/]([A-Za-z0-9._-]{1,64})\/([A-Za-z0-9._-]{1,64}?)(?:\.git)?\/?$/.exec(url);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

// The PROMISE is cached, not just the resolved value: two overlapping resolves
// (e.g. two open tabs polling the same project) then share ONE `git remote`
// spawn instead of racing two. `origin` is effectively immutable per project, so
// a resolved slug is memoized for the process lifetime exactly as before.
const slugCache = new Map<string, Promise<RepoSlug | null>>();

/** Read (and memoize) the project's own `origin` slug. Arg-array git, shell:false. */
export function readOriginSlug(
  projectRoot: string,
  git: GitRunner = defaultGit,
): Promise<RepoSlug | null> {
  const cached = slugCache.get(projectRoot);
  if (cached) return cached;
  const pending = (async (): Promise<RepoSlug | null> => {
    try {
      return parseOriginSlug(await git(["remote", "get-url", "origin"], projectRoot));
    } catch {
      return null;
    }
  })();
  if (slugCache.size > 128) slugCache.clear();
  slugCache.set(projectRoot, pending);
  return pending;
}

/** Test-only: reset the memoized origin slugs. */
export function _clearOriginSlugCache(): void {
  slugCache.clear();
}

function sameSlug(a: RepoSlug, b: RepoSlug): boolean {
  // GitHub owner/repo are case-insensitive.
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase()
  );
}

/**
 * The last PR marker in `transcript` that belongs to `expected`.
 *
 * `expected == null` (origin unknown / not github) → null: we cannot prove the
 * marker is ours, so we decline rather than check a possibly-foreign number.
 */
export function extractPrMarker(
  transcript: string,
  expected: RepoSlug | null,
): PrMarker | null {
  if (!transcript || !expected) return null;
  let last: PrMarker | null = null;
  PR_URL_IN_TEXT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PR_URL_IN_TEXT.exec(transcript)) !== null) {
    const n = validatePrNumber(m[3]);
    if (n == null) continue;
    const found = { owner: m[1], repo: m[2] };
    if (!sameSlug(found, expected)) continue; // a sibling repo's PR is not ours
    last = { number: n, url: m[0], owner: found.owner, repo: found.repo };
  }
  return last;
}
