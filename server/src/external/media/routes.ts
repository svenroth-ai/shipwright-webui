/*
 * external/media/routes.ts — GET /api/external/projects/:projectId/media.
 *
 * Range-capable streaming route for video (the SmartViewer <video> pane).
 * Distinct from /file because video breaks /file's two invariants:
 *   1. /file caps at 5 MB; real videos exceed that.
 *   2. <video> issues HTTP Range requests — Safari refuses to play without
 *      206 Partial Content, and loading a large file into RAM per request
 *      (as /file's readFileSync does) is untenable.
 *
 * So this route streams via fs.createReadStream with byte bounds and never
 * buffers the whole file. The /file route is left untouched (Chesterton's
 * Fence: its atomic-read design has a documented race-avoidance rationale).
 *
 * Security: shares core/path-guard.ts with /file — pathGuard (string) +
 * realPathGuard (symlink/realpath escape), null-byte hard-rejected. The
 * path is confined to the project root; read-only; no shell, no spawn.
 * CLAUDE.md rule 10 (realpath, not startsWith).
 */

import { Hono } from "hono";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, basename } from "node:path";
import { Readable } from "node:stream";

import { pathGuard, realPathGuard } from "../../core/path-guard.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";
import { sanitizeContentDispositionFilename } from "../file/_helpers.js";
import { VIDEO_MIME_BY_EXTENSION, parseRangeHeader } from "./_helpers.js";

export interface MediaRouterDeps {
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
}

export function createMediaRouter(deps: MediaRouterDeps): Hono {
  const app = new Hono();
  const { getProjectById } = deps;

  app.get("/api/external/projects/:projectId/media", async (c) => {
    const projectId = c.req.param("projectId");
    const project = getProjectById?.(projectId);
    if (!project) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    if (!project.path) {
      return c.json({ error: "project_path_unavailable", projectId }, 400);
    }

    const relpath = c.req.query("path");
    if (!relpath || relpath.length === 0) {
      return c.json({ error: "path_required" }, 400);
    }
    const guard = pathGuard(project.path, relpath);
    if (!guard.ok) {
      const err = guard.reason === "traversal" ? "path_traversal" : guard.reason;
      return c.json({ error: err, detail: guard.reason }, 400);
    }

    let st;
    try {
      st = await stat(guard.absolute);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return c.json({ error: "not_found", path: relpath }, 404);
      }
      return c.json(
        { error: "file_stat_failed", detail: String(err).slice(0, 200) },
        500,
      );
    }

    if (!st.isFile()) {
      return c.json({ error: "not_a_file", path: relpath }, 400);
    }

    // Symlink-escape defense (mirrors /file): the file exists, so realpath
    // resolves — verify it is still under the project root.
    const realGuard = realPathGuard(project.path, guard.absolute);
    if (!realGuard.ok) {
      return c.json({ error: "path_traversal", detail: realGuard.reason }, 400);
    }

    const rawExt = extname(guard.absolute).toLowerCase().slice(1);
    const mime = VIDEO_MIME_BY_EXTENSION[rawExt];
    if (!mime) {
      return c.json(
        { error: "unsupported_media_type", extension: rawExt || null },
        415,
      );
    }

    const size = st.size;
    const filename = sanitizeContentDispositionFilename(basename(guard.absolute));
    const range = parseRangeHeader(c.req.header("range"), size);

    if (range.kind === "unsatisfiable") {
      c.header("Content-Range", `bytes */${size}`);
      c.header("Accept-Ranges", "bytes");
      return c.json({ error: "range_not_satisfiable" }, 416);
    }

    // Headers common to 200 and 206.
    c.header("Content-Type", mime);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Accept-Ranges", "bytes");
    c.header("Content-Disposition", `inline; filename="${filename}"`);
    c.header("Cache-Control", "private, max-age=0, must-revalidate");

    if (range.kind === "ok") {
      const { start, end } = range;
      const chunkSize = end - start + 1;
      c.header("Content-Range", `bytes ${start}-${end}/${size}`);
      c.header("Content-Length", String(chunkSize));
      c.status(206);
      const node = createReadStream(guard.absolute, { start, end });
      return c.body(Readable.toWeb(node) as unknown as ReadableStream);
    }

    c.header("Content-Length", String(size));
    const node = createReadStream(guard.absolute);
    return c.body(Readable.toWeb(node) as unknown as ReadableStream);
  });

  return app;
}
