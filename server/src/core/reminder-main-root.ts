/*
 * reminder-main-root.ts — resolve a registered project path to its MAIN checkout.
 *
 * `reminder_cli.py due` reads the reminder store from the main root, but reads
 * the triage half from the checkout top of the path it is given, so a project
 * registered at a linked git worktree would answer differently (and could miss
 * due triage items). The CLI contract says to call it from the main checkout.
 *
 * A linked worktree's `.git` is a FILE reading `gitdir: <main>/.git/worktrees/<name>`.
 * That is parsed directly (no `git` spawn): anything that does not match the
 * linked-worktree shape (a normal checkout, a submodule, a missing path) is
 * returned unchanged.
 */

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface MainRootDeps {
  isFile?: (p: string) => boolean;
  readText?: (p: string) => string;
}

const defaultIsFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

export function resolveMainCheckout(projectPath: string, deps: MainRootDeps = {}): string {
  const isFile = deps.isFile ?? defaultIsFile;
  const readText = deps.readText ?? ((p: string) => readFileSync(p, "utf-8"));
  const dotGit = path.join(projectPath, ".git");
  if (!isFile(dotGit)) return projectPath;
  try {
    const m = /^gitdir: *(.+)$/m.exec(readText(dotGit));
    if (!m) return projectPath;
    const gitdir = path.resolve(projectPath, m[1].trim());
    const worktrees = path.dirname(gitdir);
    const dotGitDir = path.dirname(worktrees);
    if (path.basename(worktrees) === "worktrees" && path.basename(dotGitDir) === ".git") {
      return path.dirname(dotGitDir);
    }
  } catch {
    // unreadable .git file: fall through to the path as registered
  }
  return projectPath;
}
