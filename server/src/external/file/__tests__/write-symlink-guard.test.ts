/*
 * write-symlink-guard.test.ts — PUT /file rejects a `.md`-named symlink
 * escape (F09, iterate-2026-07-10-file-write-symlink-guard).
 *
 * Defect: the markdown-only write boundary validates the `.md` extension on
 * the pathGuard's string-resolved path (the symlink's NAME) while the write
 * follows the symlink to its realpath. A within-root symlink
 * `notes.md -> shipwright_run_config.json` therefore passes both the
 * extension allowlist and the realpath CONTAINMENT check, yet clobbers a
 * non-markdown file — defeating the write boundary and the read-only
 * run-config invariant (DO-NOT #12), up to code-execution via a build-script
 * / git-hook target.
 *
 * Fix: lstat the target (does NOT follow the final component) and reject any
 * final-component symlink outright with 403 `symlink_forbidden`.
 *
 * Two coverage paths for the SAME guard:
 *   1. Real symlink, end-to-end through createExternalRoutes — the canonical
 *      regression. Skipped where file symlinks need elevation (Windows dev
 *      hosts without Developer Mode); RUNS on Linux CI (ubuntu-latest).
 *   2. Mocked lstat via the registerMarkdownWrite `lstatSync` seam —
 *      deterministic and cross-platform, so the rejection branch is covered
 *      even where (1) is skipped.
 *
 * Both are structurally identical (matching If-Match → PUT → expect 403 +
 * target byte-identical); both are RED on pre-fix `main` (the write SUCCEEDS,
 * 200, target clobbered) and green after the fix.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  lstatSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../../../core/sdk-sessions-store.js";
import { SessionWatcher } from "../../../core/session-watcher.js";
import {
  createExternalRoutes,
  type ExternalRouteProjectView,
} from "../../routes.js";
import { __clearGitignoreCacheForTests } from "../../../core/gitignore-cache.js";
import { fileFingerprint } from "../_helpers.js";
import { registerMarkdownWrite } from "../write.js";

function inMemoryDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    readFile: async (p) => {
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => {
      files.set(p, data);
      existing.add(p);
    },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => {
      existing.add(p);
    },
    ensureFile: (p) => {
      if (!files.has(p)) files.set(p, "");
      existing.add(p);
    },
  };
}

/** Can this host create a *file* symlink? (Windows needs admin / Dev Mode.) */
function canCreateFileSymlink(): boolean {
  const probe = mkdtempSync(path.join(tmpdir(), "symcap-"));
  try {
    writeFileSync(path.join(probe, "t"), "x");
    symlinkSync(path.join(probe, "t"), path.join(probe, "l"));
    return lstatSync(path.join(probe, "l")).isSymbolicLink();
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

const SYMLINKS_AVAILABLE = canCreateFileSymlink();
const itRealSymlink = SYMLINKS_AVAILABLE ? it : it.skip;

describe("PUT /file — symlink-escape write defense (F09)", () => {
  let projectDir: string;
  const projectId = "p-symlink-guard";
  let project: ExternalRouteProjectView;

  beforeEach(() => {
    projectDir = mkdtempSync(path.join(tmpdir(), "symlink-guard-"));
    __clearGitignoreCacheForTests();
    project = { id: projectId, name: "test", path: projectDir };
  });

  afterEach(() => {
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const fileUrl = (p: string) =>
    `/api/external/projects/${projectId}/file?path=${encodeURIComponent(p)}`;

  async function fullChainApp(): Promise<Hono> {
    const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const watcher = new SessionWatcher({ projectsDir: projectDir });
    const app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher,
        getProjectById: (id) => (id === projectId ? project : undefined),
        ptyManager: { get: () => undefined },
      }),
    );
    return app;
  }

  itRealSymlink(
    "real symlink: `notes.md -> config.json` is rejected 403, target untouched",
    async () => {
      // A non-markdown, security-sensitive target inside the root — stands in
      // for shipwright_run_config.json.
      const secret = '{"secret":"do-not-clobber"}\n';
      const configPath = path.join(projectDir, "config.json");
      writeFileSync(configPath, secret, "utf8");
      // The `.md`-named symlink whose target is the non-md file.
      symlinkSync(configPath, path.join(projectDir, "notes.md"));

      const app = await fullChainApp();

      // GET follows the symlink and returns the target's bytes + ETag, so the
      // If-Match below MATCHES — proving that pre-fix the write would proceed.
      const getRes = await app.request(fileUrl("notes.md"));
      expect(getRes.status).toBe(200);
      const etag = getRes.headers.get("etag");
      expect(etag).toBeTruthy();

      const putRes = await app.request(fileUrl("notes.md"), {
        method: "PUT",
        headers: { "If-Match": etag! },
        body: "# clobbered\n",
      });

      expect(putRes.status).toBe(403);
      expect((await putRes.json()).error).toBe("symlink_forbidden");
      // The escape target is byte-identical — the write never landed.
      expect(readFileSync(configPath, "utf8")).toBe(secret);
    },
  );

  it(
    "mocked lstat: a target reported as a symlink is rejected 403, no write-through",
    async () => {
      // A REAL regular markdown file; the injected lstat LIES that it is a
      // symlink. With a matching If-Match, pre-fix code would write through
      // (200, file clobbered) — this asserts the fix rejects it instead.
      const evilPath = path.join(projectDir, "evil.md");
      const original = "# original\n";
      writeFileSync(evilPath, original, "utf8");
      const etag = `"${fileFingerprint(readFileSync(evilPath))}"`;

      const app = new Hono();
      registerMarkdownWrite(app, {
        getProjectById: (id) => (id === projectId ? project : undefined),
        lstatSync: (p) =>
          path.basename(p) === "evil.md"
            ? { isSymbolicLink: () => true, isFile: () => true }
            : lstatSync(p),
      });

      const res = await app.request(fileUrl("evil.md"), {
        method: "PUT",
        headers: { "If-Match": etag },
        body: "# hacked\n",
      });

      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("symlink_forbidden");
      expect(readFileSync(evilPath, "utf8")).toBe(original);
    },
  );

  it(
    "a symlink reported as non-file (broken link / symlink-to-dir) is still 403",
    async () => {
      // Status-mapping probe (external plan review #5): the symlink check runs
      // BEFORE the not-a-file check, so a broken symlink or a symlink-to-dir
      // (isSymbolicLink() true, isFile() false) is rejected as symlink_forbidden
      // — never leaks a 404/400 that could be mistaken for "safe".
      const evilPath = path.join(projectDir, "evil.md");
      writeFileSync(evilPath, "# original\n", "utf8");

      const app = new Hono();
      registerMarkdownWrite(app, {
        getProjectById: (id) => (id === projectId ? project : undefined),
        lstatSync: (p) =>
          path.basename(p) === "evil.md"
            ? { isSymbolicLink: () => true, isFile: () => false }
            : lstatSync(p),
      });

      const res = await app.request(fileUrl("evil.md"), {
        method: "PUT",
        headers: { "If-Match": '"anything"' },
        body: "# hacked\n",
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("symlink_forbidden");
      expect(readFileSync(evilPath, "utf8")).toBe("# original\n");
    },
  );

  it("regular .md write still succeeds (guard is symlink-specific)", async () => {
    // Regression guard: the symlink defense must NOT break the happy path.
    const readmePath = path.join(projectDir, "README.md");
    writeFileSync(readmePath, "# hi\n", "utf8");
    const app = await fullChainApp();

    const getRes = await app.request(fileUrl("README.md"));
    const etag = getRes.headers.get("etag")!;
    const putRes = await app.request(fileUrl("README.md"), {
      method: "PUT",
      headers: { "If-Match": etag },
      body: "# updated\n",
    });
    expect(putRes.status).toBe(200);
    expect(readFileSync(readmePath, "utf8")).toBe("# updated\n");
  });
});
