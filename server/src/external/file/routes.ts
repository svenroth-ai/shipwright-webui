/*
 * external/file/routes.ts — GET /api/external/projects/:projectId/file.
 *
 * Byte-streams a project-local file with:
 *   - X-Content-Type-Options: nosniff
 *   - Explicit Content-Type per extension (never inferred)
 *   - Content-Disposition: inline; filename="<sanitized>"
 *   - CSP default-src 'none' (defense-in-depth for SVG)
 *
 * Status codes per _c2_api_baseline.json:
 *   400 on traversal / absolute input / not-a-file
 *   404 on missing project / missing file
 *   413 if > 5 MB
 *   415 if extension not in the text/markdown/image allowlist
 *   500 on file_read_failed / file_stat_failed
 *
 * CLAUDE.md rule 10 / ADR-044: null-byte input hard-rejected via the
 * path-guard; realpath escape via symlink → 400 path_traversal.
 */

import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, basename } from "node:path";

import { pathGuard, realPathGuard } from "../../core/path-guard.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";
import {
  FILE_MAX_BYTES,
  MIME_BY_EXTENSION,
  sanitizeContentDispositionFilename,
} from "./_helpers.js";

export interface FileRouterDeps {
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
}

export function createFileRouter(deps: FileRouterDeps): Hono {
  const app = new Hono();
  const { getProjectById } = deps;

  app.get("/api/external/projects/:projectId/file", async (c) => {
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

    // Symlink-escape defense. The stat above already succeeded, so the
    // target exists — realpath will verify it's still under project root.
    // If the file is a symlink whose target is outside the root, reject.
    const realGuard = realPathGuard(project.path, guard.absolute);
    if (!realGuard.ok) {
      return c.json(
        { error: "path_traversal", detail: realGuard.reason },
        400,
      );
    }

    if (st.size > FILE_MAX_BYTES) {
      return c.json(
        { error: "file_too_large", maxBytes: FILE_MAX_BYTES, size: st.size },
        413,
      );
    }

    const rawExt = extname(guard.absolute).toLowerCase().slice(1);
    const mime = MIME_BY_EXTENSION[rawExt];
    if (!mime) {
      return c.json(
        {
          error: "binary_not_previewable",
          mime: `application/octet-stream`,
          extension: rawExt || null,
        },
        415,
      );
    }

    const filename = sanitizeContentDispositionFilename(basename(guard.absolute));

    // Read the full file into memory. This is safe because the 5 MB cap is
    // already enforced above. We avoid streaming to dodge a race in test
    // teardown (file disappearing before drain) AND to make
    // Content-Length + body atomic.
    let body: Buffer;
    try {
      body = readFileSync(guard.absolute);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return c.json({ error: "not_found", path: relpath }, 404);
      }
      return c.json(
        { error: "file_read_failed", detail: String(err).slice(0, 200) },
        500,
      );
    }

    // Set security headers BEFORE sending body.
    c.header("Content-Type", mime);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Disposition", `inline; filename="${filename}"`);
    c.header("Content-Length", String(body.length));
    c.header("Cache-Control", "private, max-age=0, must-revalidate");
    // Defense-in-depth for SVG (CAN embed <script>): when an SVG is loaded
    // via <iframe>, browsers WILL execute inline script. CSP blocks that
    // in every viewer. For non-SVG responses the CSP is harmless.
    // `default-src 'none'` also prevents sub-resource loads (the
    // SmartViewer image renderer uses <img src>, which is unaffected).
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );

    // Return the raw bytes. Hono wraps a Uint8Array into the Response body
    // as-is; Content-Type is NOT mutated (we set it above).
    return c.body(new Uint8Array(body));
  });

  return app;
}
