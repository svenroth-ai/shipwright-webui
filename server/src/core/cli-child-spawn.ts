/*
 * cli-child-spawn.ts — shared spawn wrapper for the short-lived CLI
 * bridges (`triage-cli-runner.ts`, `codex-oracle-runner.ts`). Both wrap
 * `uv run --no-project --python ">=3.11" <script>` and previously carried
 * byte-identical `execFile(..., { timeout }, cb)` implementations —
 * factored out here so a fix lands once instead of twice, and so the two
 * copies can't re-diverge.
 *
 * Required-CI PR-review finding on PR #466: `execFile`'s own `timeout`
 * option only signals the IMMEDIATE child (`uv`); if `uv run` has already
 * forked a Python grandchild by the time it fires, Node does not reap that
 * grandchild on Windows. Accepted as low-severity for triage-cli-runner.ts
 * (fires only on a user click) but NOT for codex-oracle-runner.ts, which
 * fires every 60s per stalled task indefinitely — the same theoretical gap
 * at a much higher exposure rate. Fixed here by driving our OWN timer that
 * tree-kills the whole process group instead of relying on Node's
 * single-process kill — reusing `preview-child-lifecycle.ts`'s `treeKill`
 * (win32 `taskkill /t /f`, POSIX `kill(-pid)`) rather than adding the
 * `tree-kill` npm package, which `decision_log.md` records as a
 * deliberately pruned dependency.
 *
 * `execFile` is replaced with `spawn` (matching `preview-session-manager.
 * ts`'s own spawn call) because `execFile`'s TypeScript surface has no
 * `detached` option at all — and `detached: platform !== "win32"` is
 * load-bearing, not incidental: POSIX `treeKill` signals the process
 * GROUP via a negative pid, which only exists if the child led its own
 * group at spawn time. Without it `kill(-pid)` ESRCHes and silently
 * degrades to a single-process kill — the exact case this module exists
 * to close. stdout/stderr are accumulated manually and truncated (not
 * errored) past the 1MB cap — a truncated JSON payload still fails the
 * caller's `JSON.parse` the same way an old `maxBuffer` error used to,
 * without adding a distinct overflow error path to keep in sync.
 *
 * `error.killed` is NOT how a timeout is detected here (unlike the old
 * per-file implementations) — our tree-kill goes around `child.kill()`
 * entirely (an external `taskkill` process, or a raw `process.kill(-pid)`),
 * so `ChildProcess#killed` never flips true for it. An explicit `timedOut`
 * flag, set the instant our timer fires, is the only correct signal.
 */
import { spawn, type ChildProcess } from "node:child_process";

import { treeKill as realTreeKill } from "./preview-child-lifecycle.js";

const MAX_BUFFER_CHARS = 1024 * 1024;

export interface CliChildSpawnResult {
  code: number;
  stdout: string;
  stderr: string;
  spawnError?: string;
}

export type CliChildSpawnFn = (
  bin: string,
  args: string[],
  options: { timeoutMs: number; env: NodeJS.ProcessEnv },
) => Promise<CliChildSpawnResult>;

export interface CliChildSpawnDeps {
  /** Injected for tests — a fake `spawn`. */
  spawnFn?: typeof spawn;
  /** Injected for tests — a fake `treeKill`. */
  treeKillFn?: typeof realTreeKill;
  /** Injected for tests — overrides `process.platform`. */
  platform?: NodeJS.Platform;
}

// Every real child this process has spawned via `createCliChildSpawn` and
// has not yet seen exit — index.ts's shutdown() tree-kills whatever remains
// here, mirroring the existing `previewManager.killAll()` / `ptyManager.
// killAll()` precedent (a stalled-task tick can leave one in flight; the
// 30s-per-call timeout alone is not a shutdown guarantee, since a hard
// process.exit() can fire well inside that window).
const trackedChildren = new Set<ChildProcess>();

/** Tree-kill every currently in-flight CLI child. Best-effort, synchronous
 *  (matches `PreviewSessionManager.killAll()` / `PtyManager.killAll()`).
 *  `treeKillFn` is injectable — tests exercise the registry without a real
 *  platform-dependent `taskkill`/`process.kill` side effect. */
export function killAllTrackedCliChildren(treeKillFn: typeof realTreeKill = realTreeKill): void {
  for (const child of trackedChildren) {
    try {
      treeKillFn(child, "SIGKILL");
    } catch {
      // best-effort — nothing more to do for an already-dead child
    }
  }
  trackedChildren.clear();
}

function appendBounded(current: string, chunk: string): string {
  const next = current + chunk;
  return next.length > MAX_BUFFER_CHARS ? next.slice(0, MAX_BUFFER_CHARS) : next;
}

// Local PR-review preflight finding, round 2 (PR #466): the tree-kill call
// on timeout is fire-and-forget — an external `taskkill` process (win32) or
// a raw `process.kill(-pid)` (POSIX) — and neither GUARANTEES a `close`
// event follows (an unresponsive process, a `taskkill` that itself failed
// silently). Without a second bound, a failed kill would leave the
// returned promise pending and the child in `trackedChildren` forever,
// defeating the "bounded" half of "bounded/reaped subprocess strategy".
const KILL_GRACE_MS = 5000;

export function createCliChildSpawn(deps: CliChildSpawnDeps = {}): CliChildSpawnFn {
  const spawnFn = deps.spawnFn ?? spawn;
  const treeKillFn = deps.treeKillFn ?? realTreeKill;
  const platform = deps.platform ?? process.platform;

  return (bin, args, options) =>
    new Promise((resolve) => {
      let timedOut = false;
      let settled = false;
      let stdout = "";
      let stderr = "";
      let timer: ReturnType<typeof setTimeout>;
      let killGraceTimer: ReturnType<typeof setTimeout> | undefined;

      const child = spawnFn(bin, args, {
        windowsHide: true,
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
        // See module header — spawn/kill must agree on whether a
        // process group exists.
        detached: platform !== "win32",
      });
      trackedChildren.add(child);

      child.stdout?.setEncoding("utf-8");
      child.stderr?.setEncoding("utf-8");
      child.stdout?.on("data", (chunk: string) => {
        stdout = appendBounded(stdout, chunk);
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr = appendBounded(stderr, chunk);
      });

      const finish = (result: CliChildSpawnResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (killGraceTimer) clearTimeout(killGraceTimer);
        trackedChildren.delete(child);
        resolve(result);
      };

      child.once("error", (err: NodeJS.ErrnoException) => {
        finish({
          code: -1,
          stdout,
          stderr,
          spawnError: typeof err.code === "string" ? err.code : "spawn_error",
        });
      });

      child.once("close", (code) => {
        if (timedOut) return finish({ code: 124, stdout, stderr, spawnError: "timeout" });
        return finish({ code: code ?? 1, stdout, stderr });
      });

      timer = setTimeout(() => {
        timedOut = true;
        try {
          treeKillFn(child, "SIGKILL", { platform });
        } catch {
          // best-effort — the grace timer below bounds the promise
          // regardless of whether the kill itself threw or was ignored.
        }
        killGraceTimer = setTimeout(() => {
          finish({ code: 124, stdout, stderr, spawnError: "timeout" });
        }, KILL_GRACE_MS);
        killGraceTimer.unref?.();
      }, options.timeoutMs);
      timer.unref?.();
    });
}

export const defaultCliChildSpawn: CliChildSpawnFn = createCliChildSpawn();
