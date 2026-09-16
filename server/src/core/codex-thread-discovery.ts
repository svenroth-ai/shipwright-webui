/*
 * core/codex-thread-discovery.ts — Codex Light §4's missing piece: how a
 * fresh Codex launch's `threadId` actually gets captured. v1 launches Codex
 * as a plain interactive TUI in a pty (§2.2) — there is no app-server call
 * (deferred to Stage 2) and no `--session-id`-equivalent flag Codex accepts
 * at the top level (`codex --help`, verified live against an installed
 * Codex CLI: no such flag exists), so the id must be DISCOVERED after the
 * fact, filename-first — the exact pattern CLAUDE.md rule 3 already uses
 * for Claude's own JSONL discovery.
 *
 * Verified live (2026-09-16, codex-cli 0.147.0) against a real installed
 * Codex CLI: every session — interactive or subagent — writes a rollout
 * file to `~/.codex/sessions/<local-YYYY>/<local-MM>/<local-DD>/rollout-
 * <local-ISO-with-dashes-for-colons>-<thread-id>.jsonl`, whose FIRST line
 * is always `{"type":"session_meta","payload":{"id":"<thread-id>","cwd":
 * "<abs-path>",...}}` — the thread id is in the filename AND the first
 * line's payload, mirroring the filename-first + first-line-sanity-check
 * shape Claude's own discovery already uses. `cwd` is the launch working
 * directory verbatim (OS-native separators), letting us match a rollout
 * file to the task that spawned it without Codex ever needing to accept a
 * caller-supplied id.
 *
 * Consumed by `CodexTaskWatcher` (`codex-task-watcher.ts`): on every tick,
 * a live Codex task with no `threadId` yet gets one discovery attempt;
 * `null` is not an error (the rollout file may not have flushed to disk
 * yet, or Codex may still be starting up) — the caller just retries next
 * tick. Once found, `threadId` is patched onto the task record and the
 * §4 resume branch (`runtime-chokepoint.ts`'s `resume = Boolean(task.
 * threadId)`) starts working on the task's next launch.
 *
 * Known, accepted limitation (doubt-review, disposition: documented, not
 * fixed): matching is purely (cwd, launch-time window) — there is no
 * possession/identity proof tying a candidate rollout file to THIS
 * webui-spawned pty specifically. An operator manually running `codex` in
 * the same project directory, in another terminal, within the same
 * discovery window would produce an indistinguishable rollout file; if it
 * happens to be the earliest unclaimed match, it gets bound to the wrong
 * task (and, once `threadId` is set, discovery never re-runs for that
 * task, so the mistake is not self-correcting). Accepted because it needs
 * an external actor deliberately racing the exact window, has no
 * destructive blast radius (a wrong `threadId` just makes `codex resume`
 * on the Resume button open the wrong-but-still-real thread, not corrupt
 * anything), and there is no stronger signal Codex's CLI exposes to
 * disambiguate against in v1.
 */

import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface CodexThreadDiscoveryDeps {
  readdir: (dir: string) => Promise<string[]>;
  /** Reads just the head of a file — rollout files can be large, but `session_meta` is always the very first line. */
  readHead: (filePath: string, maxBytes: number) => Promise<string>;
  homeDir: () => string;
}

const ROLLOUT_RE =
  /^rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.jsonl$/;
/**
 * Disposition (doubt-review, low-severity, accepted not fixed): if a
 * rollout file's first `session_meta` JSON line ever exceeds this many
 * bytes, `JSON.parse` on the truncated head throws, the candidate is
 * skipped, and — with no larger-buffer retry — that task's discovery
 * fails identically on every later tick (permanent, not degrading: the
 * `resume` branch never fires and every "Resume" click silently
 * relaunches fresh). Accepted because the verified real `session_meta`
 * line (module header) is compact, and 4KB is a generous margin over it;
 * revisit with a retry-on-parse-failure if a future Codex CLI version
 * ever grows this payload.
 */
const HEAD_BYTES = 4096;

export function codexSessionsRoot(deps: Pick<CodexThreadDiscoveryDeps, "homeDir">): string {
  return path.join(deps.homeDir(), ".codex", "sessions");
}

function normalizeCwd(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** The launch day plus a one-day hedge either side, against a local-midnight folder-boundary race. */
function dayFolders(since: Date): string[] {
  const days = [-1, 0, 1].map((offset) => {
    const d = new Date(since.getTime());
    d.setDate(d.getDate() + offset);
    const y = String(d.getFullYear());
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return path.join(y, m, day);
  });
  return [...new Set(days)];
}

function parseFilenameTimestamp(stamp: string): number {
  // "2026-09-16T07-32-17" -> "2026-09-16T07:32:17" (local — no zone suffix,
  // matching how `new Date()` already parses a zone-less ISO string: local).
  const iso = stamp.replace(/T(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3");
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export interface DiscoverCodexThreadIdArgs {
  cwd: string;
  /** ISO-8601 — only rollout files at/after this instant are considered. */
  sinceIso: string;
  /** Skip these thread ids — already claimed by another task this process knows about. */
  excludeThreadIds?: ReadonlySet<string>;
}

/**
 * Best-effort, filename-first discovery of the thread id a fresh Codex
 * launch produced. Returns `null` (not an error) when nothing matches yet.
 */
export async function discoverCodexThreadId(
  args: DiscoverCodexThreadIdArgs,
  deps: CodexThreadDiscoveryDeps,
): Promise<string | null> {
  const since = new Date(args.sinceIso);
  if (Number.isNaN(since.getTime())) return null;
  const sinceMs = since.getTime() - 5_000; // small clock-skew grace
  const wantCwd = normalizeCwd(args.cwd);
  const root = codexSessionsRoot(deps);

  const candidates: { ts: number; threadId: string; file: string }[] = [];
  for (const folder of dayFolders(since)) {
    const dir = path.join(root, folder);
    let names: string[];
    try {
      names = await deps.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const m = ROLLOUT_RE.exec(name);
      if (!m) continue;
      const threadId = m[2];
      if (args.excludeThreadIds?.has(threadId)) continue;
      const ts = parseFilenameTimestamp(m[1]);
      if (ts < sinceMs) continue;
      candidates.push({ ts, threadId, file: path.join(dir, name) });
    }
  }
  candidates.sort((a, b) => a.ts - b.ts);

  for (const candidate of candidates) {
    let head: string;
    try {
      head = await deps.readHead(candidate.file, HEAD_BYTES);
    } catch {
      continue;
    }
    const firstLine = head.split("\n", 1)[0];
    let parsed: unknown;
    try {
      parsed = JSON.parse(firstLine);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    if ((parsed as Record<string, unknown>).type !== "session_meta") continue;
    const payload = (parsed as Record<string, unknown>).payload;
    if (!payload || typeof payload !== "object") continue;
    const id = (payload as Record<string, unknown>).id;
    const cwd = (payload as Record<string, unknown>).cwd;
    if (typeof id === "string" && typeof cwd === "string" && normalizeCwd(cwd) === wantCwd) {
      return id;
    }
  }
  return null;
}

export const defaultCodexThreadDiscoveryDeps: CodexThreadDiscoveryDeps = {
  readdir: (dir) => fsPromises.readdir(dir),
  readHead: async (filePath, maxBytes) => {
    const fh = await fsPromises.open(filePath, "r");
    try {
      const buf = Buffer.alloc(maxBytes);
      const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
      return buf.toString("utf-8", 0, bytesRead);
    } finally {
      await fh.close();
    }
  },
  homeDir: () => os.homedir(),
};
