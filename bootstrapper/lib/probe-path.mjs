/**
 * probe-path.mjs — where the prerequisite probe LOOKS for a binary.
 *
 * Split out of preflight.mjs (iterate-2026-08-22): the "augment the lookup PATH
 * and resolve a bare name to an absolute executable" concern is cohesive and
 * independently testable, and keeping it here holds preflight.mjs under the
 * 300-line ceiling. preflight.mjs owns the VERDICT; this module owns the LOOKUP.
 */

import { accessSync, constants as fsConstants, statSync } from "node:fs";
import path from "node:path";

/**
 * Return a copy of `baseEnv` whose PATH also contains the well-known user-level
 * bin dirs that the uv and Claude Code installers write to.
 *
 * WHY (Mac cold-start, iterate-2026-08-22): those installers drop their binary
 * in `~/.local/bin` (and Homebrew in `/opt/homebrew/bin` | `/usr/local/bin`) and
 * only APPEND that dir to the shell rc. The npx process that runs this
 * bootstrapper still carries the PATH captured before the install, so a
 * `shell: false` probe reported a perfectly-installed uv/claude as ABSENT until
 * the user opened a fresh terminal. Augmenting the lookup PATH lets the probe
 * find a just-installed tool without the restart.
 *
 * The extra dirs are APPENDED, never prepended — an explicitly-configured tool
 * on the real PATH always wins; `~/.local/bin` is only a fallback. Bare-name,
 * PATH-only: no cwd is ever added, so the win32-spawn security posture holds.
 *
 * Windows subtlety: `process.env` is case-insensitive but a plain object is not,
 * so we collapse every `path`-cased key into a single canonical `PATH` — never
 * hand spawn both a stale `Path` and an augmented `PATH`.
 *
 * @param {NodeJS.Platform} platform
 * @param {string} homedir
 * @param {Record<string, string | undefined>} [baseEnv]
 * @returns {Record<string, string>}
 */
export function probeEnv(platform, homedir, baseEnv = {}) {
  const sep = platform === "win32" ? ";" : ":";
  const extra =
    platform === "win32"
      ? [path.win32.join(homedir, ".local", "bin")]
      : [path.posix.join(homedir, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];

  const out = {};
  let current = "";
  for (const [k, v] of Object.entries(baseEnv)) {
    if (k.toLowerCase() === "path") {
      if (v != null) current = v;
      continue; // drop every path-cased key; a single PATH is re-added below
    }
    if (v != null) out[k] = v;
  }
  const merged = current ? current.split(sep).filter(Boolean) : [];
  for (const d of extra) if (!merged.includes(d)) merged.push(d);
  out.PATH = merged.join(sep);
  return out;
}

/**
 * Resolve a bare command name to an absolute executable path by scanning the
 * (already augmented) PATH — POSIX only. Node's own bare-name lookup does not
 * reliably honour `options.env.PATH`, so we resolve the absolute path ourselves
 * and spawn THAT, making the augmented PATH actually take effect. PATH-only,
 * never cwd. Returns the bare name unchanged when nothing resolves (spawn then
 * yields the same ENOENT → `ok:false` verdict as before).
 * @param {string} name @param {Record<string,string|undefined>} env
 */
export function resolvePosixBin(name, env) {
  if (name.includes("/")) return name; // already a path
  for (const dir of (env.PATH ?? "").split(":")) {
    if (!dir) continue;
    const cand = path.posix.join(dir, name);
    try {
      if (statSync(cand).isFile()) {
        accessSync(cand, fsConstants.X_OK);
        return cand;
      }
    } catch {
      // not a usable executable here — keep searching
    }
  }
  return name;
}
