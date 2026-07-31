/**
 * win32-spawn.mjs — resolve a command to argv that `child_process` can run with
 * `shell: false`, including Windows `.cmd`/`.bat` shims.
 *
 * WHY THIS EXISTS. On Windows the tools this package probes are shims, not
 * executables: `claude` is often `claude.cmd`, `npm`/`npx` always are. Node's
 * CVE-2024-27980 hardening EINVAL-blocks a direct `.cmd` spawn under
 * `shell: false`, and `CreateProcess` only ever appends `.exe` — so a bare
 * `claude` simply is not found. The historical workaround was `shell: true`,
 * which buys shim resolution at the price of handing a command line to cmd.exe.
 * This module buys the same resolution without the shell: find the real file via
 * PATHEXT, then invoke `.cmd`/`.bat` through an explicit `cmd.exe /d /s /c`
 * with DISCRETE argv.
 *
 * MIRROR — this is a deliberate copy of `server/src/core/preview-win32-spawn.ts`
 * (ADR-044, reviewed there; audit findings F03 + F31). It is duplicated rather
 * than imported because `bootstrapper/` is a separately published npm package
 * and DO-NOT #7 forbids cross-package imports.
 *
 * DIVERGENCES from the server original — the COMPLETE list, so a future drift
 * reviewer diffing the two files knows what is intentional:
 *   1. An unresolvable BARE name returns `null` here; the server throws
 *      `PreviewProfileInvalidError`. This package reports a missing prerequisite
 *      as a verdict line rather than crashing the installer.
 *   2. Signature. Here: `resolveSpawn(argv, { platform, env })`, both injectable
 *      (the bootstrapper has no DI container, and its tests must reach the win32
 *      branch from Linux). Server: `resolveSpawn(argv, cwd)`, reading the process
 *      globals directly.
 *   3. No `cwd` parameter. A path-like name resolves against `process.cwd()`
 *      here; the server resolves against the caller-supplied previewed-project
 *      cwd, because it is handling an UNTRUSTED repo and this is not. The
 *      security-relevant half is identical: a BARE name resolves from PATH only,
 *      never cwd, in both.
 *   4. `win32ComSpec` is exported and env-parameterised here (server: private).
 *   5. An unresolvable BARE name falls back to spawning the bare name itself
 *      (`{command: name}`) instead of giving up. The server refuses — its Guard 6
 *      is a FROZEN security guard and stays. Safe here, and NOT a hole, because
 *      verified on Windows 11: a bare-name spawn under `shell: false` is
 *      PATH-only — a planted `.\swplantedexe.exe` with `cwd` set to its own
 *      directory returns ENOENT, so cmd.exe's cwd-first lookup is still not in
 *      play. It is REQUIRED because `realpathSync.native` cannot follow an
 *      App-Execution-Alias reparse point at all, so PATHEXT resolution fails for
 *      a genuinely INSTALLED Microsoft-Store Python exactly as it does for the
 *      stub — and refusing would hard-fail the installer on a machine with a
 *      working Python. `CreateProcess` follows the alias fine (verified: the
 *      bare spawn reaches it and it answers).
 *
 * WHAT GUARDS THE PARITY. `test/win32-spawn.test.mjs` pins THIS file's contract
 * only — it cannot observe the server original changing. The cross-file guard is
 * `server/src/test/win32-spawn-mirror-parity.test.ts`, which reads both files and
 * fails if a security-load-bearing invariant is present in one and not the other.
 * It lives in the SERVER package on purpose: CI runs vitest for `client` and
 * `server` only, so a guard placed here would not gate anything.
 *
 * SECURITY posture, inherited verbatim from the original:
 *   - A bare EXTENSION-LESS name resolves from PATH **only**, never the current
 *     directory, so a planted `.\npm.cmd` cannot shadow the real tool. cmd.exe's
 *     own lookup WOULD search cwd first, which is why an unresolved bare name is
 *     never delegated to `cmd /c <bare>`; it goes to CreateProcess, which is
 *     PATH-only (verified on Windows 11). NOTE the narrow wording: a bare name
 *     that already CARRIES a `.cmd`/`.bat` extension skips resolution and is
 *     wrapped as given, so `resolveSpawn(["npm.cmd"])` would reach cmd.exe's
 *     cwd-first lookup. No caller does that (all three pass extension-less names
 *     or absolute paths), and the case is pinned by a test so the gap cannot be
 *     re-opened silently.
 *   - Candidates are realpath-verified before use (same posture as
 *     `server/src/core/path-guard.ts`).
 *   - `resolveSpawn` never sets `options.shell`. cmd.exe gets discrete argv when
 *     no token needs quoting; a spaced token produces the canonical verbatim
 *     `cmd /d /s /c ""<quoted>" <args>"` line instead.
 */

import path from "node:path";
import { statSync, realpathSync } from "node:fs";

const WIN32_EXECUTABLE_EXTS = new Set([".exe", ".com"]);
const WIN32_SHIM_EXTS = new Set([".cmd", ".bat"]);

/** Absolute path to cmd.exe, preferring the environment's own ComSpec. */
export function win32ComSpec(env = process.env) {
  const fromEnv = env.ComSpec ?? env.COMSPEC;
  if (fromEnv && fromEnv.trim()) return fromEnv;
  const root = env.SystemRoot ?? env.windir ?? "C:\\Windows";
  return path.join(root, "System32", "cmd.exe");
}

function looksPathLike(name) {
  return name.includes("\\") || name.includes("/") || /^[a-zA-Z]:/.test(name);
}

/**
 * Resolve `name` to a concrete on-disk file via PATHEXT, realpath-verified.
 * Returns undefined when nothing resolves.
 *
 * Every fs error is swallowed and the search continues — NOT only ENOENT.
 * Verified 2026-07-31 on Windows 11: `realpathSync.native` on the Microsoft
 * Store App-Execution-Alias `…\WindowsApps\python3.EXE` throws **EACCES**, not
 * ENOENT. Treating that as fatal would abandon the scan and report a machine
 * with a perfectly good `python` as having no Python at all.
 */
function resolveViaPathExt(name, env) {
  const exts = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  const firstFile = (base, withBare) => {
    for (const ext of withBare ? ["", ...exts] : exts) {
      try {
        const real = realpathSync.native(base + ext);
        if (statSync(real).isFile()) return real;
      } catch {
        // no usable file at this candidate (ENOENT, EACCES on a Store alias,
        // ELOOP on a broken reparse point) — keep searching
      }
    }
    return undefined;
  };

  if (looksPathLike(name)) {
    // Explicit path — honour an exact match first, then PATHEXT.
    return firstFile(path.resolve(name), true);
  }
  // Bare command — PATH only, never cwd. The empty ext is excluded so an
  // extensionless POSIX shim is not matched.
  for (const dir of (env.PATH ?? env.Path ?? "").split(";")) {
    const trimmed = dir.trim();
    if (!trimmed) continue;
    const hit = firstFile(path.join(trimmed, name), false);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Characters cmd.exe would otherwise INTERPRET, and which a surrounding pair of
 * double quotes makes literal. A token carrying one of these must therefore be
 * quoted even when it has no whitespace — otherwise a PATH directory such as
 * `C:\tools&more\` turns `…\tools&more\claude.cmd` into two commands.
 *
 * DELIBERATELY NOT IN THIS SET, because quoting does not fix them:
 *   `%`  — `%VAR%` expands inside double quotes too. No caller can supply one
 *          (`SAFE_ARG` in claude-cli.mjs rejects `%`, preflight's args are fixed
 *          literals), and the server original refuses `%` in its upstream fence.
 *   `"`  — a token containing a quote cannot be wrapped safely by this scheme at
 *          all; the callers' charset gates are what keep one from arriving.
 * Both limits are stated rather than papered over.
 */
const WIN32_CMD_SPECIAL = /[&|<>^]/;

function win32NeedsQuote(token) {
  return token === "" || /\s/.test(token) || WIN32_CMD_SPECIAL.test(token);
}

export function win32CmdWrap(target, rest, env = process.env) {
  const parts = [target, ...rest];
  const command = win32ComSpec(env);
  // No token has a space → discrete argv: cmd.exe /d /s /c runs each token
  // literally and the caller keeps shell:false.
  if (!parts.some(win32NeedsQuote)) {
    return { command, args: ["/d", "/s", "/c", ...parts] };
  }
  // A token has a space (e.g. `C:\Program Files\nodejs\npm.cmd`). Under `cmd /s`
  // Node's own arg-quoting is stripped, so build the canonical
  // `cmd /d /s /c ""<quoted-shim>" <args>"` line and pass it verbatim: `/s`
  // strips ONLY the outer quote pair, leaving the inner quotes intact.
  const inner = parts.map((p) => (win32NeedsQuote(p) ? `"${p}"` : p)).join(" ");
  return {
    command,
    args: ["/d", "/s", "/c", `"${inner}"`],
    windowsVerbatimArguments: true,
  };
}

/**
 * Compute the `{command, args, windowsVerbatimArguments?}` to hand to
 * child_process with `shell: false`. POSIX is a pass-through.
 *
 *   - argv0 is a real `.exe`/`.com`  → spawn it directly (no cmd.exe).
 *   - argv0 is a `.cmd`/`.bat` shim  → run through `cmd.exe /d /s /c`.
 *   - argv0 is a bare name           → resolve via PATH+PATHEXT, then as above.
 *   - nothing resolves for a bare name → `null` (caller reports "not found").
 *
 * @param {string[]} argv command followed by its arguments
 * @param {{ platform?: string, env?: Record<string, string | undefined> }} [opts]
 *        injected for tests; defaults read the live process
 * @returns {{ command: string, args: string[], windowsVerbatimArguments?: boolean } | null}
 */
export function resolveSpawn(argv, opts = {}) {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  if (platform !== "win32") {
    return { command: argv[0], args: argv.slice(1) };
  }
  const name = argv[0];
  const rest = argv.slice(1);
  const ext = path.extname(name).toLowerCase();

  if (WIN32_EXECUTABLE_EXTS.has(ext)) {
    return { command: name, args: rest };
  }
  if (!WIN32_SHIM_EXTS.has(ext)) {
    const resolved = resolveViaPathExt(name, env);
    if (resolved) {
      if (WIN32_EXECUTABLE_EXTS.has(path.extname(resolved).toLowerCase())) {
        return { command: resolved, args: rest };
      }
      return win32CmdWrap(resolved, rest, env);
    }
    // Unresolved BARE name. Never DELEGATE it to `cmd /d /s /c <bare>` — that is
    // cmd.exe's own cwd-first lookup and a planted `.\claude.cmd` would win it.
    // Hand it to CreateProcess directly instead: verified PATH-only (a planted
    // `.\x.exe` is ENOENT even with cwd set to its directory), and the only way
    // to reach an App-Execution-Alias, which realpath cannot follow — that is
    // how a real Store-installed Python stays detectable. A truly absent tool
    // comes back ENOENT and the callers turn that into their "not found" verdict.
    if (!looksPathLike(name)) return { command: name, args: rest };
  }
  return win32CmdWrap(name, rest, env);
}
