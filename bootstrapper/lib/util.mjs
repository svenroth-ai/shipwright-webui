/**
 * util.mjs — pure, dependency-free helpers shared across the bootstrapper.
 *
 * Everything here is side-effect free and unit-testable in isolation: SemVer
 * parsing/compare (attach-vs-swap + stale-copy decisions ride on it), platform
 * detection, and the actionable install hints a missing prerequisite must
 * print. No `claude`, no network, no filesystem — those live in the sibling
 * modules behind injected seams.
 */

/** @param {string} v @returns {[number, number, number] | null} */
export function parseSemver(v) {
  if (typeof v !== "string") return null;
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Compare two SemVer-shaped strings by MAJOR.MINOR.PATCH.
 * Returns -1 (a<b), 0 (equal or either unparseable), 1 (a>b). Pre-release
 * tails are ignored — the bootstrapper only ever needs the numeric triple.
 * @param {string} a @param {string} b @returns {-1 | 0 | 1}
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

/** @param {NodeJS.Platform} [platform] */
export function isWindows(platform = process.platform) {
  return platform === "win32";
}

/**
 * Platform-correct, copy-pasteable install command for a missing prerequisite.
 * A missing tool must never be a vague "install it" — the user gets the exact
 * line for THEIR OS. Mirrors the pointers `scripts/verify-setup.sh` prints.
 * @param {"uv"|"python"|"node"|"git"|"claude"} tool
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function installHint(tool, platform = process.platform) {
  const win = isWindows(platform);
  switch (tool) {
    case "uv":
      return win
        ? 'powershell -c "irm https://astral.sh/uv/install.ps1 | iex"'
        : "curl -LsSf https://astral.sh/uv/install.sh | sh";
    case "python":
      return win
        ? "install Python 3.11+ from https://www.python.org/downloads/ (NOT the Microsoft Store stub)"
        : "install Python 3.11+ (e.g. `brew install python` / `apt install python3`)";
    case "node":
      return "install Node.js >= 20.12.0 from https://nodejs.org/";
    case "git":
      return win
        ? "install Git from https://git-scm.com/download/win"
        : "install git (e.g. `brew install git` / `apt install git`)";
    case "claude":
      return "install Claude Code — https://docs.claude.com/en/docs/claude-code";
    default:
      return "";
  }
}

/** Minimum Node the packaged server needs (mirrors server/package.json engines). */
export const MIN_NODE = "20.12.0";

/** ASCII status glyphs — no emoji, PowerShell-5.1-safe, honest verdict blocks. */
export const MARK = Object.freeze({
  pass: "[OK]",
  fail: "[!!]",
  warn: "[??]",
  skip: "[--]",
  info: "[..]",
});
