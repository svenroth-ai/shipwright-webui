/*
 * readiness-probe-path — where the server's readiness probe LOOKS for a binary.
 *
 * "One truth, two surfaces" (FR-01.51): a VERBATIM MIRROR of the bootstrapper's
 * `bootstrapper/lib/probe-path.mjs` (probeEnv + resolvePosixBin), NOT a
 * cross-package import (CLAUDE.md rule 7 / DO-NOT #7 — no cross-package imports;
 * shared shapes are mirrored + guarded).
 *
 * WHY it must exist server-side (Mac/Windows cold-start, iterate-2026-08-23):
 * the uv and Claude Code installers drop their binary in `~/.local/bin` (and
 * Homebrew in `/opt/homebrew/bin` | `/usr/local/bin`) and only APPEND that dir
 * to the shell rc. The webui server process — spawned by the npx bootstrapper or
 * a GUI launcher — still carries the PATH captured before the install, so a
 * `shell: false` `execFile("uv", …)` reported a perfectly-installed uv as ABSENT
 * (ENOENT). That made `probeReadiness` skip the uv-managed-Python fallback and
 * report system `python3` 3.9.6 as the finding even though `uv python find`
 * would have located 3.11. The boot-time claude PATH self-heal
 * (`selfHealClaudePath`) only prepends the dir where CLAUDE lives, so when uv
 * lives elsewhere it never covered this. Augmenting the probe's lookup PATH lets
 * it find a just-installed tool without a terminal restart.
 */

import { accessSync, constants as fsConstants, statSync } from "node:fs";
import path from "node:path";

/**
 * Return a copy of `baseEnv` whose PATH also contains the well-known user-level
 * bin dirs the uv / Claude Code / Homebrew installers write to.
 *
 * The extra dirs are APPENDED, never prepended — an explicitly-configured tool
 * on the real PATH always wins; `~/.local/bin` is only a fallback. Bare-name,
 * PATH-only: no cwd is ever added.
 *
 * Windows subtlety: `process.env` is case-insensitive but a plain object is not,
 * so collapse every `path`-cased key into a single canonical `PATH` — never hand
 * spawn both a stale `Path` and an augmented `PATH`.
 */
export function probeEnv(
  platform: NodeJS.Platform,
  homedir: string,
  baseEnv: Record<string, string | undefined> = {},
): Record<string, string> {
  const sep = platform === "win32" ? ";" : ":";
  const extra =
    platform === "win32"
      ? [path.win32.join(homedir, ".local", "bin")]
      : [path.posix.join(homedir, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];

  const out: Record<string, string> = {};
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
 * Resolve a bare command name to an absolute executable by scanning the (already
 * augmented) PATH — POSIX only. Node's own bare-name lookup does not reliably
 * honour `options.env.PATH`, so we resolve the absolute path ourselves and spawn
 * THAT, making the augmented PATH actually take effect. PATH-only, never cwd.
 * Returns the bare name unchanged when nothing resolves (spawn then yields the
 * same ENOENT → `ok:false` verdict as before).
 */
export function resolvePosixBin(name: string, env: Record<string, string | undefined>): string {
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
