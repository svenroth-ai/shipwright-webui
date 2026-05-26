/*
 * external/tree/routes.ts — GET /api/external/projects/:projectId/tree.
 *
 * Returns one level of directory entries for SmartViewer / FolderTree.
 * `ignored: true` is advisory per plan § 7 O6 — the client decides
 * whether to show or hide.
 *
 * CLAUDE.md rule 10 / ADR-044: path-guard via realpath + path.relative
 * (not startsWith — symlinks/unicode/Windows junctions defeat prefix
 * checks). The `.gitignore` directory-form negation regression
 * (commit 5c7f539) is locked here too — entries that are directories
 * are tested with a trailing slash so `!/.shipwright/agent_docs/`
 * re-includes them.
 */

import { Hono } from "hono";
import { readdir } from "node:fs/promises";

import { pathGuard, realPathGuard } from "../../core/path-guard.js";
import { loadIgnore } from "../../core/gitignore-cache.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

export interface TreeRouterDeps {
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
}

export function createTreeRouter(deps: TreeRouterDeps): Hono {
  const app = new Hono();
  const { getProjectById } = deps;

  app.get("/api/external/projects/:projectId/tree", async (c) => {
    const projectId = c.req.param("projectId");
    const project = getProjectById?.(projectId);
    if (!project) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    if (!project.path) {
      return c.json({ error: "project_path_unavailable", projectId }, 400);
    }

    const relpath = c.req.query("path") ?? "";
    const guard = pathGuard(project.path, relpath);
    if (!guard.ok) {
      // Normalize guard reasons to a single client-facing error code for
      // consistency: both "absolute_input" and "drive_change" surface as
      // "path_traversal" — the UI doesn't distinguish and we avoid leaking
      // internal-guard semantics. The `detail` field preserves the precise
      // reason for server logs.
      const err = guard.reason === "traversal" ? "path_traversal" : guard.reason;
      return c.json({ error: err, detail: guard.reason }, 400);
    }

    const ig = loadIgnore(project.path);

    // Build the subpath prefix relative to project.path for ignore lookups.
    // If the caller requested "src", an entry "index.ts" should be tested
    // against "src/index.ts" so that a .gitignore rule like "src/index.ts"
    // matches. We always use POSIX separators for ignore() — the `ignore`
    // package documents that.
    const subPrefix = relpath.length > 0 && relpath !== "."
      ? relpath.replace(/\\/g, "/").replace(/\/+$/, "")
      : "";

    let entries;
    try {
      entries = await readdir(guard.absolute, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return c.json({ error: "not_found", path: relpath }, 404);
      }
      if (code === "ENOTDIR") {
        return c.json({ error: "not_a_directory", path: relpath }, 400);
      }
      return c.json(
        { error: "tree_read_failed", detail: String(err).slice(0, 200) },
        500,
      );
    }

    // Symlink-escape check — only when the caller requested a subdirectory
    // (the project root itself is trusted; it's where the user pointed us).
    // For any non-empty relpath we realpath + re-verify. A symlinked-dir
    // escape attempt lands here, NOT in pathGuard (which is string-only).
    if (relpath.length > 0 && relpath !== ".") {
      const realGuard = realPathGuard(project.path, guard.absolute);
      if (!realGuard.ok) {
        return c.json(
          { error: "path_traversal", detail: realGuard.reason },
          400,
        );
      }
    }

    const out = entries.map((d) => {
      const kind: "file" | "dir" = d.isDirectory() ? "dir" : "file";
      // `ignore` requires a relative path. Trailing slash signals "directory"
      // and is load-bearing for negation patterns like `!/.shipwright/agent_docs/`
      // — testing the bare form would silently match the broader `/.shipwright/*`
      // rule and defeat the re-include.
      const entryRelpath = subPrefix ? `${subPrefix}/${d.name}` : d.name;
      const testPath = kind === "dir" ? `${entryRelpath}/` : entryRelpath;
      const ignored = ig.ignores(testPath);
      return { name: d.name, kind, ignored };
    });

    // Stable sort — dirs first, then alpha. Keeps the UI deterministic.
    out.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return c.json({ entries: out });
  });

  return app;
}
