/*
 * win32-spawn.ts — platform-aware executable resolution: turn an argv into the
 * `{command, args}` that `child_process` can run with `shell: false`, including
 * Windows `.cmd`/`.bat` shims (D03 / audit findings F03 + F31; ADR-044).
 *
 * WHY a separate module: Windows needs PATHEXT resolution plus a cmd.exe
 * wrapper for `.cmd`/`.bat` shims — Node's CVE-2024-27980 hardening
 * EINVAL-blocks direct `.cmd` spawns under `shell: false`. POSIX is a
 * pass-through, so the existing behaviour stays byte-identical.
 *
 * WHY IT IS NOT CALLED preview-* ANY MORE (iterate-2026-08-01-win32-spawn-followups).
 * It was extracted from `preview-win32-spawn.ts`, which named it after its only
 * consumer at the time. It now has three consumer classes plus a cross-package
 * mirror, and — the load-bearing half — the old module imports
 * `PreviewProfileInvalidError` from `preview-session-manager.ts`, so every
 * consumer of the resolver dragged the whole preview subsystem into its import
 * closure. That made the BOOT path (`cli-compat.ts`) a MEMBER of the
 * preview-win32-spawn ↔ preview-session-manager ESM cycle, which PR #340
 * recorded as a new fragility. This module imports no preview module at all;
 * `preview-win32-spawn.ts` is now a thin wrapper over it that adds the throw.
 *
 * Stated precisely, because the looser version is easy to over-read: what this
 * retires is `cli-compat`'s MEMBERSHIP of the cycle, NOT the cycle itself.
 * `server/src/index.ts` still imports `preview-session-manager.js` directly, so
 * the cycle is still linked and still evaluated on every boot — it simply no
 * longer has the version gate inside it. Guard:
 * `win32-spawn.import-closure.test.ts` (transitive; the mirror-parity test only
 * does a single non-transitive check on this file).
 *
 * RETURN CONTRACT: an unresolvable BARE name yields `null` — "I could not
 * place this on PATH", which is a verdict, not an exception. The preview
 * wrapper converts that `null` into `PreviewProfileInvalidError` for its own
 * callers; nothing else has to.
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
 *     NOTE that fence guards the PREVIEW caller only — `cli-compat` passes an
 *     already-resolved binary path, and the bootstrapper mirror has its own
 *     `SAFE_ARG` charset gate. This module never assumes it ran.
 *   - `resolveSpawn` never sets `options.shell`. It hands cmd.exe DISCRETE argv
 *     when no token needs quoting; for a spaced token it emits the canonical
 *     verbatim `cmd /d /s /c ""<quoted-shim>" <args>"` line. Separators are
 *     refused upstream, so no token can break that quoting.
 *
 * PATH-FLAVOUR DISCIPLINE (iterate-2026-08-01-win32-spawn-followups). The win32
 * branch is reached whenever `process.platform` SAYS win32 — including when a
 * test stubs it on a POSIX host — but `path` follows the REAL host. Every
 * `path.*` call below is therefore classified, exhaustively:
 *
 *   (a) win32 command-STRING semantics → `path.win32` explicitly.
 *       `extname` ×2 and the ComSpec `join`. These never touch the filesystem,
 *       so pinning the flavour costs nothing on Windows (there `path` already
 *       IS `path.win32`) and makes the stubbed branch faithful everywhere else.
 *   (b) HOST-filesystem addressing → the host `path`, deliberately.
 *       `resolve` + `join` inside `resolveViaPathExt` build candidates that are
 *       handed to `realpathSync`/`statSync`, so they must address the fs the
 *       process is actually running on. A win32-flavoured candidate on a POSIX
 *       host (`/tmp/x/a\name.EXE`) names no real file.
 *
 * The `PATH` split stays the hardcoded win32 `;` — correct by construction and
 * already host-independent. This repo has paid for the (a)-class gap before:
 * `claude-bin-resolver.ts` records NINE red CI runs from using the host `path`
 * on `C:\…` inputs under a POSIX runner.
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
  // (a) pure string — win32 flavour pinned, so a POSIX host with a stubbed
  // platform emits `…\System32\cmd.exe`, not the mixed `…/System32/cmd.exe`
  // the host `path.join` produced (which is what loosened the old assertions).
  return path.win32.join(root, "System32", "cmd.exe");
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
    // (b) HOST flavour on purpose — this candidate goes straight to realpath.
    return firstFile(path.resolve(cwd, name), true);
  }
  // Bare command — search PATH ONLY, never the untrusted previewed-project cwd:
  // a planted `<cwd>\npm.exe` must not shadow the real tool (a shell resolves
  // bare names from PATH, not cwd). Path-like commands stay cwd-relative above.
  // The empty ext is excluded so an extensionless POSIX shim (the `npm` bash
  // script) is not matched.
  const dirs: string[] = [];
  // `;` is the win32 PATH delimiter, hardcoded — already host-independent.
  for (const dir of (process.env.PATH ?? process.env.Path ?? "").split(";")) {
    if (dir.trim()) dirs.push(dir.trim());
  }
  for (const dir of dirs) {
    // (b) HOST flavour on purpose — see the classification in the header.
    const hit = firstFile(path.join(dir, name), false);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Characters cmd.exe INTERPRETS, and which a surrounding pair of double quotes
 * makes literal. A token carrying one must be quoted even without whitespace.
 *
 * Added iterate-2026-07-31-win32-shell-spawn-remediation. Until then the
 * whitespace test alone was load-bearing only because the ONE caller sat behind
 * `preview-session-manager.tokenizeCommand`, which refuses these characters in
 * the profile command — but that fence never saw the RESOLVED path, and
 * `resolveViaPathExt` builds one out of PATH directories. A user whose PATH
 * contains `C:\R&D\` therefore got `cmd /d /s /c C:\R&D\tool.cmd`, which cmd
 * splits at the `&`. Verified on Windows 11: discrete → "'C:\…\R' is not
 * recognized as an internal or external command"; quoted → the shim runs.
 *
 * DELIBERATELY ABSENT, because quoting does not neutralise them:
 *   `%` — `%VAR%` expands inside double quotes too (the upstream fence refuses it).
 *   `"` — a token containing a quote cannot be wrapped safely by this scheme.
 */
const WIN32_CMD_SPECIAL = /[&|<>^]/;

function win32NeedsQuote(token: string): boolean {
  return token === "" || /\s/.test(token) || WIN32_CMD_SPECIAL.test(token);
}

function win32CmdWrap(target: string, rest: string[]): ResolvedSpawn {
  const parts = [target, ...rest];
  const command = win32ComSpec();
  // No token needs quoting → discrete argv: Node quotes nothing it needn't and
  // cmd.exe /d /s /c runs each token literally (caller keeps shell:false).
  if (!parts.some(win32NeedsQuote)) {
    return { command, args: ["/d", "/s", "/c", ...parts] };
  }
  // A token needs quoting (e.g. `C:\Program Files\nodejs\npm.cmd`). Under `cmd /s`
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
 *   - argv0 is an unresolvable BARE name → `null` (see the return contract in
 *     the module header). The preview wrapper turns that into a throw.
 */
export function resolveSpawn(argv: string[], cwd: string): ResolvedSpawn | null {
  if (process.platform !== "win32") {
    return { command: argv[0], args: argv.slice(1) };
  }
  const name = argv[0];
  const rest = argv.slice(1);
  // (a) pure string — win32 segment rules. On a POSIX host the host `extname`
  // treats the whole `C:\a.b\tool` as ONE segment and answers `.b\tool` where
  // Windows answers `""`.
  //
  // This closes a LATENT divergence rather than a live bug, and the reason is
  // about the CALLERS, not about all inputs: `cli-compat` passes an
  // already-resolved absolute binary, and the preview command is fenced
  // upstream, so neither can produce a name whose two flavours land in
  // different branches. A pathological leading-dot basename DOES differ —
  // `x\.exe` is `.exe` under POSIX rules (spawned directly) but `""` under
  // win32 (basename `.exe`, a dotfile, so it falls through to PATHEXT
  // resolution) — and win32 is the correct answer there. An earlier version of
  // this comment claimed the general implication; Stage-2 review disproved it.
  const ext = path.win32.extname(name).toLowerCase();

  if (WIN32_EXECUTABLE_EXTS.has(ext)) {
    return { command: name, args: rest };
  }
  if (!WIN32_SHIM_EXTS.has(ext)) {
    const resolved = resolveViaPathExt(name, cwd);
    if (resolved) {
      // (a) `resolved` is a host realpath; `path.win32` reads `/` as a
      // separator too, so this is correct on either host.
      if (WIN32_EXECUTABLE_EXTS.has(path.win32.extname(resolved).toLowerCase())) {
        return { command: resolved, args: rest };
      }
      return win32CmdWrap(resolved, rest);
    }
    // Unresolved. A BARE (non-path-like) name resolves from PATH ONLY (never
    // cwd) — so if PATHEXT can't find it we REFUSE here. Delegating
    // `cmd /d /s /c <bare>` would let cmd.exe do its own cwd-first lookup and run
    // a planted `<cwd>\npm.cmd` from an untrusted previewed repo. A path-like
    // name (absolute or `.`/`..`-relative) is the author's explicit target, so
    // it still wraps below.
    if (!looksPathLike(name)) return null;
  }
  return win32CmdWrap(name, rest);
}
