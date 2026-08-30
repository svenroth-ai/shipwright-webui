/*
 * external/file/exists-routes.ts — GET
 * /api/external/projects/:projectId/files/exist?paths=a,b,c.
 *
 * Batched, read-only existence check reusing the same `pathGuard` +
 * `realPathGuard` boundary as the file-read route (CLAUDE.md rule 10), but no
 * content is ever read — just `stat`. Feeds the Triage file viewer's
 * link-vs-plain-text decision (iterate-2026-08-30-triage-file-viewer-followups):
 * the caller supplies both the structured `evidencePath` field and
 * regex-extracted free-text mentions, either of which can point at a path
 * that no longer exists or never did — the WHOLE-request 400s stay reserved
 * for a malformed REQUEST (missing project, missing `?paths`, batch cap), but
 * an individual bad path (traversal, absolute, symlink escape, not-a-file,
 * missing) resolves to `false` in the map rather than failing the batch.
 */

import { Hono } from "hono";
import { stat, realpath } from "node:fs/promises";

import { pathGuard, realPathGuard } from "../../core/path-guard.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

/** Hard cap on paths per request — this is a UI convenience batch, not a bulk API. */
const MAX_PATHS_PER_REQUEST = 50;

export interface FileExistsRouterDeps {
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
}

async function pathExists(
  projectPath: string,
  relpath: string,
  realProjectRoot: string | undefined,
): Promise<boolean> {
  const guard = pathGuard(projectPath, relpath);
  if (!guard.ok) return false;

  let st;
  try {
    st = await stat(guard.absolute);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;

  // Same symlink-escape defense as the file-read route: a project-local
  // symlink whose target resolves outside the project root must not be
  // reported as an existing, viewable file.
  return realPathGuard(projectPath, guard.absolute, realProjectRoot).ok;
}

export function createFileExistsRouter(deps: FileExistsRouterDeps): Hono {
  const app = new Hono();
  const { getProjectById } = deps;

  app.get("/api/external/projects/:projectId/files/exist", async (c) => {
    const projectId = c.req.param("projectId");
    const project = getProjectById?.(projectId);
    if (!project) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    if (!project.path) {
      return c.json({ error: "project_path_unavailable", projectId }, 400);
    }

    const raw = c.req.query("paths");
    if (!raw || raw.length === 0) {
      return c.json({ error: "paths_required" }, 400);
    }
    // Each segment is percent-decoded (client encodes with encodeURIComponent)
    // so a literal comma inside a path can't be mistaken for the delimiter —
    // code-review finding, iterate-2026-08-30-triage-file-viewer-followups.
    // A segment that fails to decode (malformed %-escape) is treated as
    // literal text rather than 400ing the whole batch — it will simply not
    // match a real file and resolve to `false` below.
    const paths = raw
      .split(",")
      .filter((p) => p.length > 0)
      .map((p) => {
        try {
          return decodeURIComponent(p);
        } catch {
          return p;
        }
      });
    if (paths.length > MAX_PATHS_PER_REQUEST) {
      return c.json(
        { error: "too_many_paths", max: MAX_PATHS_PER_REQUEST, received: paths.length },
        400,
      );
    }

    // Resolve the project root's realpath ONCE for the whole batch rather
    // than once per path — up to 50 paths would otherwise each pay a
    // redundant realpathSync(root) inside realPathGuard, doubling the
    // blocking-syscall count for no benefit (doubt-review finding,
    // iterate-2026-08-30-triage-file-viewer-followups). `undefined` on
    // failure falls back to realPathGuard's own per-call resolution, which
    // then fails closed exactly as it did before this change.
    const realProjectRoot = await realpath(project.path).catch(() => undefined);

    const results = await Promise.all(
      paths.map(async (p) => [p, await pathExists(project.path, p, realProjectRoot)] as const),
    );
    const exists: Record<string, boolean> = {};
    for (const [p, ok] of results) exists[p] = ok;

    return c.json({ exists });
  });

  return app;
}
