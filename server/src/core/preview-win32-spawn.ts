/*
 * preview-win32-spawn.ts — platform-aware executable resolution for the
 * preview dev-server spawn (D03 / audit findings F03 + F31).
 *
 * WHY a separate module: Windows needs PATHEXT resolution plus a cmd.exe
 * wrapper for `.cmd`/`.bat` shims — Node's CVE-2024-27980 hardening
 * EINVAL-blocks direct `.cmd` spawns under `shell: false`. That is a
 * self-contained concern with a narrow surface, kept out of
 * preview-session-manager.ts (which sits at its bloat ceiling). POSIX is a
 * pass-through, so the existing behaviour stays byte-identical.
 *
 * SECURITY (ADR-044 — `shell: false` on EVERY path):
 *   - `splitWin32Command` never treats backslash as an escape, so
 *     `C:\tools\node.exe` survives verbatim (F31). The caller refuses any
 *     command carrying a shell command-execution metacharacter BEFORE it is
 *     ever tokenized or resolved.
 *   - `resolveSpawn` NEVER sets `options.shell` and NEVER builds a single
 *     joined command string. A `.cmd`/`.bat` shim is delivered to cmd.exe as
 *     DISCRETE argv (`/d /s /c <shim> <arg> …`) — each argument is its own
 *     array element, so cmd.exe receives every token literally and no
 *     character can act as a command separator.
 *   - With command-execution metacharacters already refused upstream, nothing
 *     that reaches cmd.exe can be interpreted as a command — the refuse-fence
 *     makes the safety proof trivial.
 */

import path from "node:path";
import { statSync, realpathSync } from "node:fs";

const WIN32_EXECUTABLE_EXTS = new Set([".exe", ".com"]);
const WIN32_SHIM_EXTS = new Set([".cmd", ".bat"]);

export interface ResolvedSpawn {
  command: string;
  args: string[];
}

/**
 * Tokenize a win32 dev command WITHOUT POSIX backslash-escaping, so
 * `C:\tools\node.exe` keeps its backslashes (audit F31). Honours double quotes
 * for grouping args that contain spaces. Assumes the caller has already
 * refused command-execution metacharacters (the injection fence lives in
 * preview-session-manager.tokenizeCommand).
 */
export function splitWin32Command(command: string): string[] {
  const argv: string[] = [];
  let cur = "";
  let inDouble = false;
  let started = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === '"') {
      inDouble = !inDouble;
      started = true;
      continue;
    }
    if (!inDouble && (ch === " " || ch === "\t")) {
      if (started) {
        argv.push(cur);
        cur = "";
        started = false;
      }
      continue;
    }
    cur += ch;
    started = true;
  }
  if (started) argv.push(cur);
  return argv;
}

function win32ComSpec(): string {
  const fromEnv = process.env.ComSpec ?? process.env.COMSPEC;
  if (fromEnv && fromEnv.trim()) return fromEnv;
  const root = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
  return path.join(root, "System32", "cmd.exe");
}

function looksPathLike(name: string): boolean {
  return name.includes("\\") || name.includes("/") || /^[a-zA-Z]:/.test(name);
}

/**
 * Resolve `name` to a concrete on-disk file via PATHEXT, realpath-verified
 * (same realpath posture as core/path-guard.ts). Returns undefined when
 * nothing resolves. Only called for names lacking a recognised extension.
 */
function resolveViaPathExt(name: string, cwd: string): string | undefined {
  const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  const firstFile = (base: string, withBare: boolean): string | undefined => {
    for (const ext of withBare ? ["", ...exts] : exts) {
      try {
        const real = realpathSync.native(base + ext);
        if (statSync(real).isFile()) return real;
      } catch {
        // no file at this candidate — keep searching
      }
    }
    return undefined;
  };

  if (looksPathLike(name)) {
    // Explicit path — honour an exact match first, then PATHEXT.
    return firstFile(path.resolve(cwd, name), true);
  }
  // Bare command — search cwd + PATH with PATHEXT only. Windows never runs an
  // extensionless bare name off PATH, so the empty ext is excluded here (it
  // would otherwise match a POSIX shim like the extensionless `npm` script).
  const dirs = [cwd];
  for (const dir of (process.env.PATH ?? process.env.Path ?? "").split(";")) {
    if (dir.trim()) dirs.push(dir.trim());
  }
  for (const dir of dirs) {
    const hit = firstFile(path.join(dir, name), false);
    if (hit) return hit;
  }
  return undefined;
}

function win32CmdWrap(target: string, rest: string[]): ResolvedSpawn {
  // Discrete argv — NEVER a single joined string. cmd.exe /d /s /c runs the
  // shim with each token delivered literally (caller keeps shell:false).
  return { command: win32ComSpec(), args: ["/d", "/s", "/c", target, ...rest] };
}

/**
 * Compute the (command, args) to hand to child_process.spawn with
 * `shell: false`. POSIX is a pass-through (argv0 + rest). Reads
 * `process.platform` at call time so the win32/POSIX branch stays stubbable.
 *
 *   - argv0 is a real `.exe`/`.com`      → spawn it directly (no cmd.exe).
 *   - argv0 is a `.cmd`/`.bat` shim OR an unresolved bare command (npm/yarn/
 *     pnpm are `.cmd` shims) → run through `cmd.exe /d /s /c` as discrete argv.
 */
export function resolveSpawn(argv: string[], cwd: string): ResolvedSpawn {
  if (process.platform !== "win32") {
    return { command: argv[0], args: argv.slice(1) };
  }
  const name = argv[0];
  const rest = argv.slice(1);
  const ext = path.extname(name).toLowerCase();

  if (WIN32_EXECUTABLE_EXTS.has(ext)) {
    return { command: name, args: rest };
  }
  if (!WIN32_SHIM_EXTS.has(ext)) {
    const resolved = resolveViaPathExt(name, cwd);
    if (resolved) {
      if (WIN32_EXECUTABLE_EXTS.has(path.extname(resolved).toLowerCase())) {
        return { command: resolved, args: rest };
      }
      return win32CmdWrap(resolved, rest);
    }
    // Unresolved bare command — assume a shim (npm/yarn/pnpm are `.cmd`);
    // cmd.exe surfaces a clear "not recognized" error if it truly is absent.
  }
  return win32CmdWrap(name, rest);
}
