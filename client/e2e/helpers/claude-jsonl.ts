/*
 * Synthetic Claude-transcript seeding. iterate-2026-07-10-harness-hardening (A00).
 *
 * ── Why this is legitimate, and not a cheat ──────────────────────────────────
 * WebUI is a READ-ONLY observer of Claude's JSONL (CLAUDE.md rule 1 + DO-NOT #1):
 * it never spawns Claude and never writes into `~/.claude/projects/`. Task state
 * is *derived* from that file — `external/transcript/routes.ts` flips a task to
 * `active` the first time a JSONL is observed for its sessionUuid, and back to
 * `idle` on mtime age. Nothing about that path needs a live Claude process; it
 * needs a FILE.
 *
 * So a fixture that writes the JSONL is impersonating **Claude**, not webui. The
 * server observes it through exactly the code path it uses in production. That is
 * what makes the state-machine specs (v0-9-3 and friends) runnable on a CI runner
 * that has no `claude` binary at all — previously they just `test.skip`-ed
 * forever, which is a fence that never fires.
 *
 * Discovery is filename-first (rule 3): the watcher WALKS the subdirectories of
 * `~/.claude/projects/` looking for `<uuid>.jsonl` rather than recomputing the
 * cwd encoding, so the directory name only has to be plausible, not byte-exact.
 *
 * ⚠️ SAFETY: self-locks exactly like `helpers/isolated-store.ts`. It will refuse
 * to write unless the resolved home is under the OS temp dir AND the isolation
 * sentinel is set — a fumbled env can therefore never scribble into the
 * developer's REAL `~/.claude/projects/`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ISOLATION_SENTINEL_ENV, homeFromEnv } from "./isolated-store";

/** `<home>/.claude/projects` — mirrors server/src/core/session-watcher.ts PROJECTS_DIR. */
export function claudeProjectsDir(): string {
  return path.join(homeFromEnv(), ".claude", "projects");
}

/** Claude's directory convention: the cwd with path separators folded to `-`. */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/[\\/:]+/g, "-").replace(/^-+/, "");
}

function assertIsolatedHome(): string {
  const home = homeFromEnv();
  const real = (p: string) => {
    try {
      return fs.realpathSync.native(p);
    } catch {
      return path.resolve(p);
    }
  };
  const norm = (s: string) => (process.platform === "win32" ? s.toLowerCase() : s);
  const rel = path.relative(norm(real(os.tmpdir())), norm(real(home)));
  const underTmp = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  const sentinel = process.env[ISOLATION_SENTINEL_ENV] === "1";
  if (!sentinel || !underTmp) {
    throw new Error(
      `[claude-jsonl SELF-LOCK] Refusing to write into ${path.join(home, ".claude", "projects")}: ` +
        `seeding a synthetic transcript requires an isolated temp-USERPROFILE/HOME stack. ` +
        `Required: ${ISOLATION_SENTINEL_ENV}=1 (set=${sentinel}) AND home under the OS temp dir ` +
        `(underTmp=${underTmp}, home=${home}). Without this a fumbled run would scribble ` +
        `into the developer's REAL ~/.claude/projects.`,
    );
  }
  return home;
}

/** One JSONL event line, in the shape Claude writes. */
function line(sessionId: string, type: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    sessionId,
    type,
    timestamp: new Date().toISOString(),
    ...extra,
  });
}

/**
 * Write a synthetic `<sessionUuid>.jsonl` so the server observes the task as
 * having a live transcript. Returns the file path.
 *
 * The first line carries `sessionId` — the secondary sanity check the watcher
 * applies after the filename match (rule 3).
 */
export function seedClaudeJsonl(
  opts: { sessionUuid: string; cwd: string; turns?: number },
): string {
  const home = assertIsolatedHome();
  const dir = path.join(home, ".claude", "projects", encodeCwd(opts.cwd));
  fs.mkdirSync(dir, { recursive: true });

  const { sessionUuid } = opts;
  const rows = [
    line(sessionUuid, "user", { message: { role: "user", content: "seeded by E2E fixture" } }),
  ];
  for (let i = 0; i < (opts.turns ?? 1); i++) {
    rows.push(
      line(sessionUuid, "assistant", {
        message: { role: "assistant", content: [{ type: "text", text: `seeded turn ${i + 1}` }] },
      }),
    );
  }

  const file = path.join(dir, `${sessionUuid}.jsonl`);
  fs.writeFileSync(file, rows.join("\n") + "\n", "utf-8");
  return file;
}

/**
 * Age a seeded transcript by backdating its mtime, so the server's idle
 * threshold (`ACTIVE_IDLE_THRESHOLD_MS`) trips without the spec having to sleep.
 */
export function backdateJsonl(file: string, ageMs: number): void {
  assertIsolatedHome();
  const when = new Date(Date.now() - ageMs);
  fs.utimesSync(file, when, when);
}

/**
 * Keep a transcript fresh — what a LIVE Claude session does, and the other half of
 * impersonating it.
 *
 * A resumed session is only held `active` because Claude keeps writing to the
 * JSONL; the server reads freshness straight off the mtime. On an isolated stack
 * there is no `claude` binary, so an un-touched transcript stays stale and the task
 * correctly decays back to idle — which looks like a UI bug but is the server being
 * right. A spec that asserts post-resume behaviour must therefore go on playing
 * Claude's part, not just set the stage and walk off.
 */
export function touchJsonl(file: string): void {
  assertIsolatedHome();
  const now = new Date();
  fs.utimesSync(file, now, now);
}
