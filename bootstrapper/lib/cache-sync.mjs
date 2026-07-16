/**
 * cache-sync.mjs — AC1b, the single most important fact in this sub-iterate.
 *
 * `claude plugin install` alone leaves a BROKEN install: the plugins' hooks run
 * `uv run "${CLAUDE_PLUGIN_ROOT}/../../shared/scripts/…"`, and that `shared/`
 * tree is NOT a plugin, NOT in the manifest, so `install` never delivers it.
 * Every hook of every plugin then dies at session start while the plugin still
 * lists as installed. This module absorbs the BEHAVIOUR of
 * `scripts/update-marketplace.sh` (sync shared/, full file-sync, plugins/
 * symlink layer with a Windows copy fallback, GC of stale version dirs) — but
 * NEVER its hardcoded 14-plugin list; the names come from the manifest.
 *
 * Pure over concrete paths + node:fs, so tests drive it against temp dirs.
 */

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set([
  "__pycache__",
  ".git",
  ".venv",
  "venv",
  ".pytest_cache",
  "node_modules",
]);

/** Recursively list files under `dir` (posix-relative), skipping SKIP_DIRS + *.pyc. */
export function listFiles(dir, base = dir) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out.push(...listFiles(path.join(dir, e.name), base));
    } else if (e.isFile()) {
      if (e.name.endsWith(".pyc")) continue;
      out.push(path.relative(base, path.join(dir, e.name)).split(path.sep).join("/"));
    }
  }
  return out;
}

function bytesEqual(a, b) {
  try {
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}

/**
 * Full file sync src → dst: add new, overwrite changed, remove orphans. Mirrors
 * update-marketplace.sh's deliberate "full sync regardless of version number"
 * (a version compare alone is NOT sufficient to decide "already up to date").
 * @returns {{ added: number, changed: number, removed: number }}
 */
export function fullFileSync(src, dst) {
  if (!existsSync(src)) return { added: 0, changed: 0, removed: 0 };
  mkdirSync(dst, { recursive: true });
  let added = 0;
  let changed = 0;
  let removed = 0;
  for (const rel of listFiles(src)) {
    const from = path.join(src, rel);
    const to = path.join(dst, rel);
    if (!existsSync(to)) {
      mkdirSync(path.dirname(to), { recursive: true });
      cpSync(from, to);
      added++;
    } else if (!bytesEqual(from, to)) {
      cpSync(from, to);
      changed++;
    }
  }
  const srcSet = new Set(listFiles(src));
  for (const rel of listFiles(dst)) {
    if (!srcSet.has(rel)) {
      rmSync(path.join(dst, rel), { force: true });
      removed++;
    }
  }
  return { added, changed, removed };
}

/** THE make-or-break step: marketplace `shared/` → `<cacheRoot>/shared/`. */
export function syncSharedTree(marketplaceDir, cacheRoot) {
  return fullFileSync(path.join(marketplaceDir, "shared"), path.join(cacheRoot, "shared"));
}

/** Full-sync one plugin's marketplace source into its installed version dir. */
export function syncPluginCache(marketplaceDir, name, installPath) {
  return fullFileSync(path.join(marketplaceDir, "plugins", name), installPath);
}

/**
 * The plugins/ symlink layer: `<cacheRoot>/plugins/<name>` → the version dir, so
 * cross-plugin `../../plugins/<name>` references resolve. A symlink silently
 * degrades to a copy on Windows non-admin — handle that explicitly (copy),
 * never assume the link took.
 * @returns {"symlink"|"copied"|"skipped"}
 */
export function ensurePluginsLayer(name, installPath, cacheRoot) {
  if (!installPath || !existsSync(installPath)) return "skipped";
  const linkDir = path.join(cacheRoot, "plugins");
  mkdirSync(linkDir, { recursive: true });
  const linkPath = path.join(linkDir, name);
  try {
    if (existsSync(linkPath) || isSymlink(linkPath)) {
      if (isSymlink(linkPath) && safeReadlink(linkPath) === installPath) return "symlink";
      rmSync(linkPath, { recursive: true, force: true });
    }
    symlinkSync(installPath, linkPath, "junction");
    if (isSymlink(linkPath)) return "symlink";
  } catch {
    /* fall through to copy */
  }
  fullFileSync(installPath, linkPath);
  return "copied";
}

function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function safeReadlink(p) {
  try {
    return readlinkSync(p);
  } catch {
    return null;
  }
}

/** Remove `<cacheRoot>/<name>/<v>` dirs that are not the installed version. */
export function gcStaleVersionDirs(name, cacheRoot, keepVersion) {
  const base = path.join(cacheRoot, name);
  if (!keepVersion || !existsSync(base)) return [];
  const removed = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== keepVersion) {
      rmSync(path.join(base, entry.name), { recursive: true, force: true });
      removed.push(entry.name);
    }
  }
  return removed;
}

/** Extract `${CLAUDE_PLUGIN_ROOT}/../../shared/<rel>` references from a hooks.json blob. */
export function hookSharedRefs(hooksJsonText) {
  const refs = new Set();
  const re = /\$\{CLAUDE_PLUGIN_ROOT\}((?:\/\.\.)+\/shared\/[A-Za-z0-9_./-]+)/g;
  let m;
  while ((m = re.exec(hooksJsonText)) !== null) refs.add(m[1]);
  return [...refs];
}

/**
 * AC1b post-condition self-check. For each installed plugin version dir, every
 * `${CLAUDE_PLUGIN_ROOT}/../../shared/…` its hooks.json references must resolve
 * to a real file, the plugins/ layer entry must exist, and NO stale version
 * dir may remain beside the installed one. Also asserts the canonical
 * `shared/scripts/hooks/capture_session_id.py` is present, and — when
 * `requestedNames` is passed — that EVERY requested manifest plugin actually
 * materialised (a failed/partial install can otherwise be silently "coherent").
 * @param {{ cacheRoot: string, pluginVersionDirs: {name:string, versionDir:string}[], requestedNames?: string[] }} opts
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function verifyCacheCoherent({ cacheRoot, pluginVersionDirs, requestedNames }) {
  const problems = [];
  const canary = path.join(cacheRoot, "shared", "scripts", "hooks", "capture_session_id.py");
  if (!existsSync(canary)) problems.push(`missing shared canary: ${canary}`);

  const materialised = new Set(pluginVersionDirs.map((p) => p.name));
  for (const name of requestedNames ?? []) {
    if (!materialised.has(name)) {
      problems.push(`${name}: requested by the manifest but not installed/synced (hooks would be absent)`);
    }
  }

  for (const { name, versionDir } of pluginVersionDirs) {
    const hooksJson = path.join(versionDir, "hooks", "hooks.json");
    if (existsSync(hooksJson)) {
      let text = "";
      try {
        text = readFileSync(hooksJson, "utf-8");
      } catch {
        problems.push(`${name}: hooks.json unreadable`);
      }
      for (const ref of hookSharedRefs(text)) {
        // Resolve exactly as the runtime does: relative to the version dir.
        const resolved = path.resolve(versionDir, "." + ref);
        if (!existsSync(resolved)) problems.push(`${name}: hook path does not resolve: ${resolved}`);
      }
    }
    const layer = path.join(cacheRoot, "plugins", name);
    if (!existsSync(layer) && !isSymlink(layer)) {
      problems.push(`${name}: plugins/ layer entry missing (${layer})`);
    }
    // No stale version dir may linger beside the installed version.
    const installedVersion = path.basename(versionDir);
    const base = path.join(cacheRoot, name);
    try {
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== installedVersion) {
          problems.push(`${name}: stale version dir not GC'd: ${entry.name}`);
        }
      }
    } catch {
      /* base not enumerable — the missing-plugin check above already covers it */
    }
  }
  return { ok: problems.length === 0, problems };
}

/** Best-effort: newest-looking size for a dir (used only for diagnostics). */
export function dirExists(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
