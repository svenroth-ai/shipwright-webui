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

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { pathGuard, realPathGuard } from "../path-guard.js";
import { samePath } from "./pointer.js";

export interface GitRunner {
  (args: string[], cwd: string): string;
}

/**
 * Default git invocation: an ARGUMENT ARRAY with `shell: false`. No caller
 * string is ever concatenated into a command line (ADR-044 #9 discipline).
 */
const defaultGit: GitRunner = (args, cwd) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    timeout: 5000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });

/**
 * Every root this project may read from: the configured project root plus each
 * worktree git itself reports. Returns just the project root when git is
 * unavailable or the directory is not a repo — failing CLOSED (a smaller root
 * set), never open.
 */
export function readAllowedRoots(projectRoot: string, git: GitRunner = defaultGit): string[] {
  const roots = [path.resolve(projectRoot)];
  let out: string;
  try {
    out = git(["worktree", "list", "--porcelain"], projectRoot);
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
