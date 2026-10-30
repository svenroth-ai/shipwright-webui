/*
 * Remote Control detection. Truth source is `~/.claude/sessions/<pid>.json`
 * (one file per RUNNING claude process, carrying `sessionId` and — while Remote
 * Control is on — `bridgeSessionId`). A `bridge-session` record in the session
 * JSONL only proves it was enabled ONCE, so it feeds `onceEnabled`, never
 * `active`. Liveness is a signal-0 probe: a stale file from a killed process
 * must not read as "on". Read-only (CLAUDE.md DO-NOT #1).
 */

import { lstat, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { SessionRemoteControl } from "./types.js";

export const CLAUDE_SESSIONS_DIR = path.join(homedir(), ".claude", "sessions");

export interface RemoteControlDeps {
  sessionsDir?: string;
  isPidAlive?: (pid: number) => boolean;
}

export function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = exists but not ours (alive); ESRCH = gone.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function detectRemoteControl(
  sessionUuid: string,
  bridgeSeenInJsonl: boolean,
  deps: RemoteControlDeps = {},
): Promise<SessionRemoteControl> {
  const dir = deps.sessionsDir ?? CLAUDE_SESSIONS_DIR;
  const alive = deps.isPidAlive ?? defaultIsPidAlive;
  const wanted = sessionUuid.toLowerCase();
  let onceEnabled = bridgeSeenInJsonl;
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => /^\d+\.json$/.test(f));
  } catch {
    return { active: false, onceEnabled, pid: null };
  }
  for (const f of files) {
    let rec: Record<string, unknown>;
    try {
      const fp = path.join(dir, f);
      const st = await lstat(fp);
      if (!st.isFile() || st.size > 64 * 1024) continue;
      rec = JSON.parse(await readFile(fp, "utf8")) as Record<string, unknown>;
    } catch {
      continue; // being rewritten / not JSON
    }
    if (typeof rec.sessionId !== "string" || rec.sessionId.toLowerCase() !== wanted) continue;
    const pid = typeof rec.pid === "number" ? rec.pid : Number(f.replace(/\.json$/, ""));
    if (typeof rec.bridgeSessionId === "string" && rec.bridgeSessionId) {
      onceEnabled = true;
      if (Number.isInteger(pid) && pid > 0 && alive(pid)) return { active: true, onceEnabled, pid };
    }
  }
  return { active: false, onceEnabled, pid: null };
}
