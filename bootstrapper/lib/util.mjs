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
 * tails are ignored — this is the comparator for "is tool X new enough"
 * (Node/Python floors), where only the numeric triple can matter.
 *
 * The attach-vs-swap decision needs the OPPOSITE — it must distinguish two
 * `@next` builds that share a triple (`0.24.7-next.0` vs `0.24.7-next.1`) —
 * so it uses `compareSemverFull` instead.
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

/**
 * Extract the SemVer pre-release identifiers (the dot-separated tail after the
 * first `-`, before any `+build` metadata), or `null` when there is none.
 * `0.24.7-next.1` -> ["next", "1"]; `0.24.7` -> null; junk after the triple
 * without a `-` (e.g. `2.1.132 (Claude Code)`) -> null.
 * @param {string} v @returns {string[] | null}
 */
export function parsePrerelease(v) {
  if (typeof v !== "string") return null;
  const m = /^\s*v?\d+\.\d+\.\d+-([0-9A-Za-z.-]+)/.exec(v.trim());
  if (!m) return null;
  return m[1].split(".");
}

/**
 * Compare two pre-release identifier lists per SemVer §11.4: a version WITHOUT
 * a pre-release outranks one WITH; numeric identifiers rank below alphanumeric
 * ones; a longer list outranks its own prefix. Both `null` (no pre-release) → 0.
 * @param {string[] | null} a @param {string[] | null} b @returns {-1 | 0 | 1}
 */
function comparePrereleaseIds(a, b) {
  // A version WITHOUT a pre-release outranks one WITH (1.0.0 > 1.0.0-next).
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i];
    const bi = b[i];
    const an = /^\d+$/.test(ai);
    const bn = /^\d+$/.test(bi);
    if (an && bn) {
      const d = Number(ai) - Number(bi);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (an !== bn) {
      // Numeric identifiers always have lower precedence than alphanumeric.
      return an ? -1 : 1;
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

/**
 * Compare two SemVer-shaped strings by triple AND pre-release tail. Returns
 * -1 / 0 / 1, or 0 when either triple is unparseable (never a false swap
 * trigger). This is the attach-vs-swap comparator: successive `@next` test
 * builds share a MAJOR.MINOR.PATCH and differ ONLY in `-next.N`, so a
 * triple-only compare would report them equal and ATTACH to the stale server
 * instead of swapping in the freshly published build.
 * @param {string} a @param {string} b @returns {-1 | 0 | 1}
 */
export function compareSemverFull(a, b) {
  const triple = compareSemver(a, b);
  if (triple !== 0) return triple;
  // Triples equal (or a side unparseable → compareSemver already returned 0
  // and we must not manufacture a difference from the tails). Only when BOTH
  // triples parsed does the pre-release tail decide.
  if (!parseSemver(a) || !parseSemver(b)) return 0;
  return comparePrereleaseIds(parsePrerelease(a), parsePrerelease(b));
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
      // Coupled to uv: the whole stack runs via `uv run`, which resolves a
      // uv-MANAGED Python — a system python3 is neither required nor sufficient.
      // Lead with the uv path; the OS package manager / python.org is the fallback.
      return win
        ? "install Python 3.11+ via uv (`uv python install 3.11`) — or from https://www.python.org/downloads/ (NOT the Microsoft Store stub)"
        : "install Python 3.11+ via uv (`uv python install 3.11`) — or your package manager (e.g. `brew install python@3.11`)";
    case "node":
      return "install Node.js >= 20.12.0 from https://nodejs.org/";
    case "git":
      return win
        ? "install Git from https://git-scm.com/download/win"
        : "install git (e.g. `brew install git` / `apt install git`)";
    case "claude":
      return win
        ? 'powershell -c "irm https://claude.ai/install.ps1 | iex"'
        : "curl -fsSL https://claude.ai/install.sh | bash";
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
