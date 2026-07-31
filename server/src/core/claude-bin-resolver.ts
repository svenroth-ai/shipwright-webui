/*
 * claude-bin-resolver.ts — WHERE the Claude CLI is, and getting its parent dir
 * onto PATH so child processes inherit it.
 *
 * Split out of cli-compat.ts (iterate-2026-07-31-win32-shell-spawn-remediation).
 * That module is the CLI *version gate* — its own header says so — and had grown
 * a second, unrelated concern: binary discovery, bolted on in v0.8.8. The two
 * together carried the file 34 lines past the 300-line ceiling, where it sat as a
 * grandfathered bloat-baseline entry; a security remediation needing a few lines
 * there could not land without paying that debt down first.
 *
 * This is a PURE RELOCATION — not one line of logic changed in the move. The
 * version gate keeps its own home, so CLAUDE.md architecture rule 10
 * ("MIN_SUPPORTED_CLI is pinned in core/cli-compat.ts") still holds.
 *
 * The `[cli-compat]` prefix on the operator warnings below is LEFT ALONE on
 * purpose. Those strings are observable output that production operators grep
 * for in the boot log; renaming them would make this a behaviour change rather
 * than a relocation, and would silently break anyone's existing log filter.
 */

import { spawnSync } from "node:child_process";
import { existsSync as fsExistsSync } from "node:fs";
import { platform } from "node:os";
import path from "node:path";

/**
 * Resolve an absolute path to the claude CLI.
 *
 * iterate-2026-05-08 v0.8.8 AC-2 — multi-strategy lookup:
 *
 *   1. `SHIPWRIGHT_CLAUDE_BIN` env override (operator pin). Loud reject
 *      if the path doesn't exist — falling back silently would mask
 *      misconfiguration that the operator explicitly set.
 *
 *   2. Primary: `where claude` (Windows) / `which claude` (POSIX).
 *      Inherits the launching shell's PATH. Prefers `.cmd` shim on
 *      Windows when multiple results match.
 *
 *   3. Fallback: walk a curated list of known install paths. Catches
 *      the common case where the launching shell's PATH did NOT include
 *      `~/.local/bin/`, npm-global, winget shim — even though the binary
 *      exists on disk. Empirically observed: tsx-watch reload after a
 *      shell change, claude installed AFTER server start, and so on.
 *
 *   4. Returns null when nothing resolves. `/api/diagnostics` then
 *      reports `claudeCli.supported = false` and the UI shows the
 *      "Claude Code CLI not found" warning.
 *
 * Logs a structured stderr line on every fallback hit so production
 * operators can diagnose PATH-drift in the server log without DevTools.
 */
export function resolveClaudeBin(): string | null {
  return resolveClaudeBinWith({
    platform: platform(),
    spawnSync,
    existsSync: fsExistsSync,
    env: process.env,
  });
}

export interface ResolveClaudeBinDeps {
  platform: NodeJS.Platform | string;
  spawnSync: typeof spawnSync;
  existsSync: (p: string) => boolean;
  env: Record<string, string | undefined>;
}

/** Test-friendly variant of resolveClaudeBin — all environment hooks injectable. */
export function resolveClaudeBinWith(deps: ResolveClaudeBinDeps): string | null {
  const isWin = deps.platform === "win32";

  // (1) Env override — explicit operator pin.
  const override = deps.env.SHIPWRIGHT_CLAUDE_BIN?.trim();
  if (override) {
    if (deps.existsSync(override)) return override;
    // Loud reject — operator set this on purpose; falling back silently
    // would hide the typo.
    // eslint-disable-next-line no-console
    console.warn(
      `[cli-compat] SHIPWRIGHT_CLAUDE_BIN=${override} does not exist; resolveClaudeBin returning null`,
    );
    return null;
  }

  // (2) Primary lookup via `where` / `which`. Wrapped in try so a
  //     missing system binary (rare on Windows, possible on minimal
  //     POSIX containers) doesn't preempt the curated fallback.
  //
  // External code review fix (gemini high): `where claude` on Windows
  // emits `INFO: Could not find files for the given pattern(s).` to
  // STDOUT (not stderr) when no match. Filter that out, otherwise the
  // first-line fallback would parse the INFO line as a path and the
  // existsSync check at the call-site would never run.
  let primaryResult: string | null = null;
  try {
    const lookup = isWin ? "where" : "which";
    const r = deps.spawnSync(lookup, ["claude"], { encoding: "utf-8", shell: false });
    if (!(r as { error?: unknown }).error) {
      const lines = ((r.stdout ?? "") as string)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .filter((l) => !/^INFO:/i.test(l)); // drop `where`'s "Could not find" notice
      if (isWin) {
        const dotCmd = lines.find((l) => /\.cmd$/i.test(l));
        if (dotCmd) primaryResult = dotCmd;
      }
      primaryResult = primaryResult ?? lines[0] ?? null;
      // Defense-in-depth: ensure the resolved path actually exists on
      // disk. `where` can sometimes return stale alias entries that
      // no longer point at a real file (operator un-installed claude
      // but kept the App Execution Alias entry).
      if (primaryResult && !deps.existsSync(primaryResult)) {
        primaryResult = null;
      }
    }
  } catch {
    /* fall through to curated paths */
  }
  if (primaryResult) return primaryResult;

  // (3) Curated fallback paths. Per-platform, priority-ordered.
  const candidates = curatedCandidates(isWin, deps.env);
  for (const candidate of candidates) {
    if (deps.existsSync(candidate)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[cli-compat] resolved claude via fallback path: ${candidate} (PATH lookup empty — operator may want to add the parent dir to PATH OR set SHIPWRIGHT_CLAUDE_BIN)`,
      );
      return candidate;
    }
  }

  return null;
}

/**
 * iterate-2026-05-08 v0.8.8 AC-3 — boot-time PATH self-heal.
 *
 * When the AC-2 fallback resolved a binary that lives in a directory
 * NOT on `process.env.PATH`, prepend that directory so subsequent
 * child processes (node-pty, preview-session-manager) inherit the
 * augmented PATH. Common scenario: user installed claude into
 * `~/.local/bin/`, opened the server from a shell that doesn't
 * source the PATH-extending dotfile (e.g. PowerShell from a fresh
 * Windows session).
 *
 * Idempotent — case-insensitive comparison on Windows, case-sensitive
 * on POSIX. Loud-logs the prepend so production operators see PATH
 * drift in the boot log.
 */
export interface SelfHealClaudePathDeps {
  bin: string | null;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform | string;
}

export interface SelfHealResult {
  augmented: boolean;
  parentDir: string | null;
}

export function selfHealClaudePath(deps: SelfHealClaudePathDeps): SelfHealResult {
  if (!deps.bin) return { augmented: false, parentDir: null };
  const isWin = deps.platform === "win32";
  const sep = isWin ? ";" : ":";
  // Use the explicit platform's path module — NOT the runner-native
  // `path` default. The runner is POSIX on Linux CI, which silently
  // mis-parses `C:\...` inputs as a single basename and returns "."
  // from `dirname`. Empirically: the 4 win32 test cases below passed on
  // Windows dev machines but failed on Ubuntu CI for 9 push-runs after
  // v0.8.5 because of this exact gap.
  const pathMod = isWin ? path.win32 : path.posix;
  const parentDir = pathMod.dirname(deps.bin);

  // External code review fix (openai medium): on Windows, environment
  // variables are case-insensitive AND many process spawners expose the
  // path variable as `Path` rather than `PATH`. If we always read+write
  // `env.PATH`, we may be looking at an empty string while the real
  // value lives at `Path` — and child processes that inherit `Path`
  // would not see the prepended dir. Detect the existing key (any
  // case) on Windows and update it in place.
  let pathKey = "PATH";
  if (isWin) {
    for (const k of Object.keys(deps.env)) {
      if (k.toLowerCase() === "path") {
        pathKey = k;
        break;
      }
    }
  }

  const currentPath = deps.env[pathKey] ?? "";
  const entries = currentPath.length > 0 ? currentPath.split(sep) : [];
  // Normalize both sides identically: strip trailing slashes/backslashes
  // (`C:\foo\` vs `C:\foo`), and case-fold on Windows.
  const stripTrailing = (s: string) => s.replace(/[\\/]+$/, "");
  const norm = (s: string) => {
    const t = stripTrailing(s);
    return isWin ? t.toLowerCase() : t;
  };
  const parentNorm = norm(parentDir);
  const alreadyPresent = entries.some((e) => norm(e) === parentNorm);
  if (alreadyPresent) {
    return { augmented: false, parentDir };
  }
  deps.env[pathKey] =
    currentPath.length > 0 ? `${parentDir}${sep}${currentPath}` : parentDir;
  // eslint-disable-next-line no-console
  console.warn(
    `[cli-compat] PATH self-heal: prepended ${parentDir} into env.${pathKey} (claude resolved via fallback; child-process spawns inherit augmented PATH)`,
  );
  return { augmented: true, parentDir };
}

function curatedCandidates(
  isWin: boolean,
  env: Record<string, string | undefined>,
): string[] {
  if (isWin) {
    const userProfile = env.USERPROFILE ?? "";
    const appData = env.APPDATA ?? "";
    const localAppData = env.LOCALAPPDATA ?? "";
    const programFiles = env.ProgramFiles ?? "";
    const c: string[] = [];
    if (userProfile) {
      c.push(path.join(userProfile, ".local", "bin", "claude.exe"));
      c.push(path.join(userProfile, ".local", "bin", "claude.cmd"));
    }
    if (appData) {
      // npm global install
      c.push(path.join(appData, "npm", "claude.cmd"));
      c.push(path.join(appData, "npm", "claude.exe"));
    }
    if (localAppData) {
      // winget shim
      c.push(path.join(localAppData, "Microsoft", "WinGet", "Links", "claude.exe"));
    }
    if (programFiles) {
      c.push(path.join(programFiles, "Claude Code", "claude.exe"));
    }
    return c;
  }
  // POSIX
  const home = env.HOME ?? "";
  const c: string[] = [];
  if (home) {
    c.push(path.posix.join(home, ".local", "bin", "claude"));
    c.push(path.posix.join(home, ".npm-global", "bin", "claude"));
  }
  c.push("/usr/local/bin/claude");
  c.push("/opt/homebrew/bin/claude"); // Apple Silicon Homebrew
  return c;
}
