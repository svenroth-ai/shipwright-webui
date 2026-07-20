/*
 * core/mission-context/worktree-roots.ts — the allowed READ-ROOT set and the
 * only document-resolution path (CONTRACT §5.1 c/d).
 *
 * WHY membership and not containment: a relocated worktree legitimately lives
 * OUTSIDE the project root. VERIFIED 2026-07-17 — the test-traceability-retrofit
 * iterate relocated its worktree to a sibling `C:\…\wt-traceability-retrofit`
 * (keys `worktree_relocated_from` / `worktree_relocated_reason`) because the
 * shared backfill scanner prunes any `.worktrees` path. So a containment test
 * (`startsWith`, or "is it under projectRoot") would both FALSELY REJECT that
 * legitimate worktree and FALSELY ACCEPT a hostile sibling directory.
 *
 * The authoritative answer comes from git itself:
 *   git worktree list --porcelain      (arg-array, shell:false, cwd=projectRoot)
 * A pointer's `worktree_path` is trusted ONLY when it is a MEMBER of that set.
 *
 * Document paths are then built from the KNOWN LAYOUT using the already
 * grammar-validated run_id / slug — never from a pointer-supplied sub-path —
 * and every read goes through `pathGuard` + `realPathGuard` against the CHOSEN
 * root, so a symlink swapped in between the descriptor and the read (TOCTOU)
 * still cannot escape.
 */

import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { pathGuard, realPathGuard } from "../path-guard.js";
import { samePath } from "./pointer.js";

/**
 * A git invocation returning the process stdout.
 *
 * The union return type is deliberate: it lets a SYNC test double
 * (`(args) => "…"`) satisfy the very same signature the ASYNC production runner
 * implements, so no injection site had to change when git went async — every
 * CALLER simply `await`s the result (awaiting a plain string is a no-op).
 */
export interface GitRunner {
  (args: string[], cwd: string): string | Promise<string>;
}

const execFileP = promisify(execFile);

/**
 * Default git invocation: an ARGUMENT ARRAY with `shell: false`, run
 * ASYNCHRONOUSLY (`execFile`, not `execFileSync`). The sync form blocked the
 * single-threaded Hono event loop for the entire git call — up to the timeout —
 * which stalled the embedded-terminal WS frames and the 1 s transcript poll, not
 * merely the Mission tab that triggered it. No caller string is ever
 * concatenated into a command line (ADR-044 #9 discipline).
 */
export const defaultGit: GitRunner = async (args, cwd) => {
  const { stdout } = await execFileP("git", args, {
    cwd,
    encoding: "utf-8",
    timeout: 5000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
};

/**
 * Every root this project may read from: the configured project root plus each
 * worktree git itself reports. Returns just the project root when git is
 * unavailable or the directory is not a repo — failing CLOSED (a smaller root
 * set), never open.
 */
export async function readAllowedRoots(
  projectRoot: string,
  git: GitRunner = defaultGit,
): Promise<string[]> {
  const roots = [path.resolve(projectRoot)];
  let out: string;
  try {
    out = await git(["worktree", "list", "--porcelain"], projectRoot);
  } catch {
    return roots;
  }
  for (const line of out.split(/\r?\n/)) {
    if (!line.startsWith("worktree ")) continue;
    const p = line.slice("worktree ".length).trim();
    if (!p) continue;
    const resolved = path.resolve(p);
    if (!roots.some((r) => samePath(r, resolved))) roots.push(resolved);
  }
  return roots;
}

interface RootsCacheEntry {
  /** The in-flight OR resolved root-set promise, shared by concurrent callers. */
  roots: Promise<string[]>;
  expiresAt: number;
}

const rootsCache = new Map<string, RootsCacheEntry>();
/**
 * A few seconds. Worktrees are created/removed only at iterate start/finalize,
 * so this is far shorter than any real churn interval — a stale entry
 * self-corrects on the very next poll and never escapes a guard (every read
 * still re-runs pathGuard + realPathGuard + the doc fingerprint).
 */
const ROOTS_TTL_MS = 5_000;
const ROOTS_CACHE_CAP = 128;

export interface AllowedRootsCacheDeps {
  git?: GitRunner;
  /** Injectable clock — real time in production, a fake in the TTL tests. */
  now?: () => number;
  ttlMs?: number;
}

/**
 * `readAllowedRoots` behind a short per-projectRoot TTL cache.
 *
 * WHY (internal code review, perf). The resolver polls once a second, and
 * `chosen.root` feeds the `rev` that keys the resolver's own response cache — so
 * the root set must be computed BEFORE that cache-hit check, and the naive call
 * spawned `git worktree list --porcelain` on every poll, cache hit or not. Here
 * a cache hit is a `Map` lookup, not a process spawn.
 *
 * The DETAIL endpoint deliberately does NOT use this — its git re-validation of
 * a minted capability must be point-in-time fresh, and it is a rare user click,
 * not a 1 s poll, so the spawn there is not worth caching away.
 */
export function readAllowedRootsCached(
  projectRoot: string,
  deps: AllowedRootsCacheDeps = {},
): Promise<string[]> {
  const now = deps.now ?? Date.now;
  const ttl = deps.ttlMs ?? ROOTS_TTL_MS;
  const key = path.resolve(projectRoot);

  const hit = rootsCache.get(key);
  if (hit && hit.expiresAt > now()) return hit.roots;

  // Cache the PROMISE, not just the resolved value: concurrent polls (or open
  // tabs) that all miss during one spawn window then share ONE
  // `git worktree list --porcelain` instead of each spawning their own
  // (external code review, openai MEDIUM). `readAllowedRoots` never rejects — it
  // catches internally and fails closed — so a rejected promise is never cached.
  const pending = readAllowedRoots(projectRoot, deps.git);
  if (rootsCache.size >= ROOTS_CACHE_CAP) rootsCache.clear();
  rootsCache.set(key, { roots: pending, expiresAt: now() + ttl });
  return pending;
}

/** Test-only: drop the module-level root-set TTL cache between cases. */
export function _clearRootsCache(): void {
  rootsCache.clear();
}

/**
 * Choose the root a document should be read from.
 *
 * Mid-run the iterate spec lives in the WORKTREE; after Finalize the worktree is
 * gone and the spec lives in the main root. So: prefer the pointer's
 * `worktree_path` when — and only when — git confirms it is a registered
 * worktree of THIS repo; otherwise fall back to the project root. A
 * `worktree_path` that is not a member is not an error, it is simply not used
 * (the post-Finalize / pruned case is the common one).
 */
export function chooseRoot(
  allowedRoots: string[],
  worktreePath: string | null | undefined,
): { root: string; isWorktree: boolean } {
  const projectRoot = allowedRoots[0];
  if (!worktreePath) return { root: projectRoot, isWorktree: false };
  const member = allowedRoots.find((r) => samePath(r, worktreePath));
  if (!member) return { root: projectRoot, isWorktree: false };
  // A registered-but-vanished worktree (pruned dir, stale git metadata) is
  // unusable — fall back rather than fail the whole resolve.
  if (!existsSync(member)) return { root: projectRoot, isWorktree: false };
  return { root: member, isWorktree: !samePath(member, projectRoot) };
}

/** True when `worktreePath` is a git-registered worktree of this repo. */
export function isRegisteredWorktree(
  allowedRoots: string[],
  worktreePath: string | null | undefined,
): boolean {
  if (!worktreePath) return false;
  return allowedRoots.some((r) => samePath(r, worktreePath));
}

export type ResolveDocResult =
  | { ok: true; absolute: string; mtimeMs: number; sizeBytes: number }
  | { ok: false; reason: "not_found" | "denied" | "not_a_file" };

/** `resolveFirstDoc` additionally reports WHICH candidate matched. */
export type ResolveFirstDocResult =
  | { ok: true; absolute: string; mtimeMs: number; sizeBytes: number; index: number }
  | { ok: false; reason: "not_found" | "denied" | "not_a_file" };

/** Hard cap on a rendered document — bounds a pathological/corrupt file (§11). */
export const MAX_DOC_BYTES = 2 * 1024 * 1024;

/**
 * Resolve `relParts` (already-validated, known-layout segments) inside `root`.
 *
 * Both guards run, in order: `pathGuard` on the string (traversal, absolute
 * input, Windows drive-hop) and then `realPathGuard` on the on-disk path
 * (symlink escape). Only after BOTH pass does the caller open the file.
 */
export function resolveDocIn(root: string, relParts: string[]): ResolveDocResult {
  const rel = relParts.join("/");
  const guard = pathGuard(root, rel);
  if (!guard.ok) return { ok: false, reason: "denied" };
  if (!existsSync(guard.absolute)) return { ok: false, reason: "not_found" };

  const real = realPathGuard(root, guard.absolute);
  if (!real.ok) return { ok: false, reason: "denied" };

  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(real.absolute);
  } catch {
    return { ok: false, reason: "not_found" };
  }
  if (!st.isFile()) return { ok: false, reason: "not_a_file" };
  return { ok: true, absolute: real.absolute, mtimeMs: st.mtimeMs, sizeBytes: st.size };
}

/**
 * Try each candidate layout in order and return the first that resolves.
 * `denied` is NOT swallowed into "not found": a guard rejection is reported so
 * the artifact can surface `unavailable` (a real integrity signal) instead of
 * the softer `not_yet_created`.
 */
export function resolveFirstDoc(
  root: string,
  candidates: string[][],
): ResolveFirstDocResult {
  let sawDenied = false;
  for (let i = 0; i < candidates.length; i++) {
    const r = resolveDocIn(root, candidates[i]);
    // The INDEX is returned so the caller never has to re-infer which candidate
    // matched by suffix-comparing a realpath against a pre-canonical path — a
    // leaf-casing normalisation would silently pick candidates[0] and pair it
    // with the OTHER file's fingerprint, leaving the node permanently
    // unopenable behind a misleading "this document has changed"
    // (internal code review, MEDIUM).
    if (r.ok) return { ...r, index: i };
    if (r.reason === "denied") sawDenied = true;
  }
  return { ok: false, reason: sawDenied ? "denied" : "not_found" };
}
