import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  fullFileSync,
  syncSharedTree,
  syncPluginCache,
  ensurePluginsLayer,
  gcStaleVersionDirs,
  hookSharedRefs,
  verifyCacheCoherent,
} from "../lib/cache-sync.mjs";

let root;
const w = (p, body = "x") => {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, body);
};

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "sw-cache-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const HOOKS_JSON = JSON.stringify({
  hooks: {
    SessionStart: [{ command: 'uv run "${CLAUDE_PLUGIN_ROOT}/../../shared/scripts/hooks/capture_session_id.py"' }],
  },
});

describe("cache-sync — hookSharedRefs", () => {
  it("extracts the ../../shared/… ref a plugin's hooks.json invokes", () => {
    expect(hookSharedRefs(HOOKS_JSON)).toEqual(["/../../shared/scripts/hooks/capture_session_id.py"]);
  });
});

describe("cache-sync — AC1b: the hooks resolve only AFTER shared/ is synced (RED → GREEN)", () => {
  it("RED: `claude plugin install` alone (no shared/) → verify FAILS", () => {
    const cacheRoot = path.join(root, "cache");
    const versionDir = path.join(cacheRoot, "plugin-01", "0.31.0");
    w(path.join(versionDir, "hooks", "hooks.json"), HOOKS_JSON);
    // The plugins/ layer + shared/ are what `install` does NOT deliver.
    ensurePluginsLayer("plugin-01", versionDir, cacheRoot);

    const before = verifyCacheCoherent({ cacheRoot, pluginVersionDirs: [{ name: "plugin-01", versionDir }] });
    expect(before.ok).toBe(false);
    expect(before.problems.some((p) => p.includes("shared canary"))).toBe(true);
    expect(before.problems.some((p) => p.includes("does not resolve"))).toBe(true);

    // GREEN: sync shared/ from the marketplace clone → the exact hook path resolves.
    const mkt = path.join(root, "mkt");
    w(path.join(mkt, "shared", "scripts", "hooks", "capture_session_id.py"), "# real hook");
    const stats = syncSharedTree(mkt, cacheRoot);
    expect(stats.added).toBeGreaterThan(0);

    const after = verifyCacheCoherent({ cacheRoot, pluginVersionDirs: [{ name: "plugin-01", versionDir }] });
    expect(after.ok).toBe(true);
    // Literal runtime resolution: versionDir/../../shared/... = cacheRoot/shared/...
    expect(existsSync(path.join(cacheRoot, "shared", "scripts", "hooks", "capture_session_id.py"))).toBe(true);
  });
});

describe("cache-sync — verify flags partial installs + stale version dirs", () => {
  it("a manifest plugin with NO installed version dir → incoherent (not silently 'ok')", () => {
    const cacheRoot = path.join(root, "cache");
    w(path.join(cacheRoot, "shared", "scripts", "hooks", "capture_session_id.py"), "# hook");
    const v = verifyCacheCoherent({
      cacheRoot,
      pluginVersionDirs: [], // plugin-01 requested but never materialised
      requestedNames: ["plugin-01"],
    });
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.includes("not installed/synced"))).toBe(true);
  });

  it("a lingering stale version dir → incoherent", () => {
    const cacheRoot = path.join(root, "cache");
    w(path.join(cacheRoot, "shared", "scripts", "hooks", "capture_session_id.py"), "# hook");
    const versionDir = path.join(cacheRoot, "plugin-01", "0.31.0");
    w(path.join(versionDir, "SKILL.md"), "cur");
    w(path.join(cacheRoot, "plugin-01", "0.0.0", "SKILL.md"), "stale");
    ensurePluginsLayer("plugin-01", versionDir, cacheRoot);
    const v = verifyCacheCoherent({ cacheRoot, pluginVersionDirs: [{ name: "plugin-01", versionDir }] });
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.includes("stale version dir"))).toBe(true);
  });
});

describe("cache-sync — fullFileSync (add / overwrite / remove orphans)", () => {
  it("adds new, overwrites changed, removes files gone from source", () => {
    const src = path.join(root, "src");
    const dst = path.join(root, "dst");
    w(path.join(src, "a.py"), "one");
    w(path.join(src, "sub", "b.md"), "two");
    w(path.join(dst, "orphan.txt"), "stale"); // not in src → must be removed

    const r1 = fullFileSync(src, dst);
    expect(r1.added).toBe(2);
    expect(r1.removed).toBe(1);
    expect(existsSync(path.join(dst, "orphan.txt"))).toBe(false);
    expect(readFileSync(path.join(dst, "a.py"), "utf-8")).toBe("one");

    writeFileSync(path.join(src, "a.py"), "changed");
    const r2 = fullFileSync(src, dst);
    expect(r2.changed).toBe(1);
    expect(readFileSync(path.join(dst, "a.py"), "utf-8")).toBe("changed");
  });

  it("skips __pycache__ / *.pyc", () => {
    const src = path.join(root, "s2");
    const dst = path.join(root, "d2");
    w(path.join(src, "keep.py"), "k");
    w(path.join(src, "__pycache__", "x.pyc"), "junk");
    w(path.join(src, "mod.pyc"), "junk");
    const r = fullFileSync(src, dst);
    expect(r.added).toBe(1);
    expect(existsSync(path.join(dst, "__pycache__"))).toBe(false);
  });
});

describe("cache-sync — syncPluginCache + GC stale version dirs", () => {
  it("full-syncs the plugin source into its version dir", () => {
    const mkt = path.join(root, "m");
    const install = path.join(root, "cache", "plugin-01", "0.31.0");
    w(path.join(mkt, "plugins", "plugin-01", "SKILL.md"), "skill");
    syncPluginCache(mkt, "plugin-01", install);
    expect(existsSync(path.join(install, "SKILL.md"))).toBe(true);
  });

  it("gcStaleVersionDirs removes non-installed version dirs only", () => {
    const cacheRoot = path.join(root, "c");
    w(path.join(cacheRoot, "plugin-01", "0.31.0", "f"), "cur");
    w(path.join(cacheRoot, "plugin-01", "0.0.0", "f"), "stale");
    const removed = gcStaleVersionDirs("plugin-01", cacheRoot, "0.31.0");
    expect(removed).toEqual(["0.0.0"]);
    expect(existsSync(path.join(cacheRoot, "plugin-01", "0.31.0"))).toBe(true);
    expect(existsSync(path.join(cacheRoot, "plugin-01", "0.0.0"))).toBe(false);
  });
});

describe("cache-sync — plugins/ layer (symlink OR Windows copy fallback)", () => {
  it("materializes the layer entry either way", () => {
    const cacheRoot = path.join(root, "cache");
    const versionDir = path.join(cacheRoot, "plugin-01", "0.31.0");
    w(path.join(versionDir, "SKILL.md"), "s");
    const mode = ensurePluginsLayer("plugin-01", versionDir, cacheRoot);
    expect(["symlink", "copied"]).toContain(mode);
    expect(existsSync(path.join(cacheRoot, "plugins", "plugin-01"))).toBe(true);
  });
});
