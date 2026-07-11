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
 * SECURITY posture (ADR-044 — `shell: false` on EVERY path). This is NOT a
 * proof of total safety:
 *   - `splitWin32Command` never treats backslash as an escape, so
 *     `C:\tools\node.exe` survives verbatim (F31).
 *   - The fence (in preview-session-manager.tokenizeCommand) is a BLOCKLIST: it
 *     refuses shell separators / substitution + `%` before resolving. It is NOT
 *     an allow-list — cmd builtins (`start`, `for`, `(…)`, `call`, `@`) survive
 *     it. It does not sandbox a hostile string: the profile author is already
 *     trusted to name an executable (a bare `.exe` is spawned directly). The
 *     fence's narrower job is to stop this cmd.exe wrapper from AMPLIFYING a
 *     `.cmd` shim into shell semantics or a lower-trust repo-cwd binary hijack.
 *   - `resolveSpawn` never sets `options.shell`. It hands cmd.exe DISCRETE argv
 *     when no token needs quoting; for a spaced token it emits the canonical
 *     verbatim `cmd /d /s /c ""<quoted-shim>" <args>"` line. Separators are
 *     refused upstream, so no token can break that quoting.
 */

import path from "node:path";
import { statSync, realpathSync } from "node:fs";

const WIN32_EXECUTABLE_EXTS = new Set([".exe", ".com"]);
const WIN32_SHIM_EXTS = new Set([".cmd", ".bat"]);

export interface ResolvedSpawn {
  command: string;
  args: string[];
  /** win32 only: set when the cmd.exe line is pre-quoted for `cmd /s` (a spaced
   *  shim path) — the caller passes it straight through to child_process.spawn. */
  windowsVerbatimArguments?: boolean;
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
  // Bare command — search PATH ONLY, never the untrusted previewed-project cwd:
  // a planted `<cwd>\npm.exe` must not shadow the real tool (a shell resolves
  // bare names from PATH, not cwd). Path-like commands stay cwd-relative above.
  // The empty ext is excluded so an extensionless POSIX shim (the `npm` bash
  // script) is not matched.
  const dirs: string[] = [];
  for (const dir of (process.env.PATH ?? process.env.Path ?? "").split(";")) {
    if (dir.trim()) dirs.push(dir.trim());
  }
  for (const dir of dirs) {
    const hit = firstFile(path.join(dir, name), false);
    if (hit) return hit;
  }
  return undefined;
}

function win32NeedsQuote(token: string): boolean {
  return token === "" || /\s/.test(token);
}

function win32CmdWrap(target: string, rest: string[]): ResolvedSpawn {
  const parts = [target, ...rest];
  const command = win32ComSpec();
  // No token has a space → discrete argv: Node quotes nothing it needn't and
  // cmd.exe /d /s /c runs each token literally (caller keeps shell:false).
  if (!parts.some(win32NeedsQuote)) {
    return { command, args: ["/d", "/s", "/c", ...parts] };
  }
  // A token has a space (e.g. `C:\Program Files\nodejs\npm.cmd`). Under `cmd /s`
  // Node's own arg-quoting is stripped, so build the canonical
  // `cmd /d /s /c ""<quoted-shim>" <args>"` line ourselves and pass it verbatim:
  // `/s` strips ONLY the outer quote pair, leaving the inner shim-path quotes
  // intact. Safe because every shell separator (and `%`) is refused upstream, so
  // no token can carry a metacharacter that would break out of the quoting.
  const inner = parts
    .map((p) => (win32NeedsQuote(p) ? `"${p}"` : p))
    .join(" ");
  return {
    command,
    args: ["/d", "/s", "/c", `"${inner}"`],
    windowsVerbatimArguments: true,
  };
}

/**
 * Compute the (command, args) to hand to child_process.spawn with
 * `shell: false`. POSIX is a pass-through (argv0 + rest). Reads
 * `process.platform` at call time so the win32/POSIX branch stays stubbable.
 *
 *   - argv0 is a real `.exe`/`.com`      → spawn it directly (no cmd.exe).
 *   - argv0 is a `.cmd`/`.bat` shim OR an unresolved bare command (npm/yarn/
 *     pnpm are `.cmd` shims) → run through `cmd.exe /d /s /c` — discrete argv,
 *     or a verbatim outer-quoted line when a token contains a space.
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
