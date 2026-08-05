/*
 * Claude CLI version gate.
 *
 * MIN_SUPPORTED_CLI is the version at which every Plan D'' architectural
 * assumption was verified by the Sub-iterate 0 PoC (see
 * ~/.claude/plans/external-launch-poc-results.md). Anything older is
 * unverified and should warn loudly via /api/diagnostics.
 */

import { spawnSync } from "node:child_process";

import { resolveClaudeBin } from "./claude-bin-resolver.js";
// The CORE resolver, deliberately NOT `preview-win32-spawn.js`: that module adds
// the preview subsystem's throw and, with it, the whole preview import closure.
// Importing it here put the boot path inside the preview ESM cycle
// (iterate-2026-08-01-win32-spawn-followups; PR #340 deferred item 3).
import { resolveSpawn, type ResolvedSpawn } from "./win32-spawn.js";

export const MIN_SUPPORTED_CLI = "2.1.114";
/**
 * Upper-bound is open-ended with a loose major cap. Anthropic bumped the
 * minor from 2.1 → 2.2 freely historically; we trust patch + minor.
 * Major bumps (3.x) MUST re-run the PoC before we lift the cap.
 */
export const MAX_SUPPORTED_CLI_MAJOR = 2;

export interface ClaudeVersionInfo {
  /** Stdout's first line, e.g. `2.1.114 (Claude Code)`. */
  raw: string;
  /** Extracted semver triple if we could parse one; null on garbage. */
  parsed: { major: number; minor: number; patch: number } | null;
  /** True iff parsed >= MIN_SUPPORTED_CLI AND parsed.major <= MAX_SUPPORTED_CLI_MAJOR. */
  supported: boolean;
}

export interface ClaudeVersionProbeDeps {
  claudeBin?: string;
  spawnSync?: typeof spawnSync;
}

/** The "we could not tell" answer. Frozen: it is handed to every caller. */
const UNKNOWN_VERSION: ClaudeVersionInfo = Object.freeze({ raw: "", parsed: null, supported: false });

/**
 * Synchronous probe for boot-time diagnostic wiring. Uses spawnSync so it
 * can block the very first response without async plumbing.
 *
 * `bin` is already absolute, so on win32 `resolveSpawn` is pure dispatch: `.exe`
 * direct, `.cmd` through an explicit `cmd.exe /d /s /c` (ADR-044's reviewed
 * resolver, spaced-path quoting included). Both failure shapes collapse to "no
 * version" rather than taking the boot path down: `null` is the resolver's own
 * "not on PATH" verdict, and the try/catch stays because `path.resolve` /
 * `realpathSync` can still throw on a pathological input — server startup must
 * survive either. (PR #340 factored this out as `versionProbeSpawn` and
 * `gradeVersion` because a second, async probe shared them; that probe had no
 * caller and is deleted, so both helpers are inlined back to their one use —
 * iterate-2026-08-01-win32-spawn-followups.)
 */
export function probeClaudeVersion(deps: ClaudeVersionProbeDeps = {}): ClaudeVersionInfo {
  const sync = deps.spawnSync ?? spawnSync;
  const bin = deps.claudeBin ?? resolveClaudeBin();
  if (!bin) return UNKNOWN_VERSION;
  let plan: ResolvedSpawn | null = null;
  try { plan = resolveSpawn([bin, "--version"], process.cwd()); } catch { plan = null; }
  if (!plan) return UNKNOWN_VERSION;
  const { windowsVerbatimArguments: verbatim } = plan;
  const result = sync(plan.command, plan.args, { encoding: "utf-8", shell: false, windowsVerbatimArguments: verbatim });
  const raw = ((result.stdout ?? "") as string).trim().split(/\r?\n/)[0] ?? "";
  const parsed = parseClaudeVersion(raw);
  return { raw, parsed, supported: isSupported(parsed) };
}

export function parseClaudeVersion(raw: string): ClaudeVersionInfo["parsed"] {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(raw);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

export function isSupported(parsed: ClaudeVersionInfo["parsed"]): boolean {
  if (!parsed) return false;
  if (parsed.major > MAX_SUPPORTED_CLI_MAJOR) return false;
  const min = parseClaudeVersion(MIN_SUPPORTED_CLI);
  if (!min) return false;
  if (parsed.major < min.major) return false;
  if (parsed.major > min.major) return true;
  if (parsed.minor < min.minor) return false;
  if (parsed.minor > min.minor) return true;
  return parsed.patch >= min.patch;
}
