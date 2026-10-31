/*
 * external/session-file/routes.ts — GET /api/external/tasks/:id/session-file?path=<abs|rel>.
 *
 * Read-only file bytes for the Smart Viewer, scoped to ONE task:
 *   - inside the project root: same posture as /projects/:id/file
 *   - outside it: only when THIS session evidences the path (Output write, chat
 *     mention, tool call) — core/session-file/access.ts. Never a directory listing.
 * Same MIME allowlist, 5 MB cap, nosniff + sandbox CSP as the project file route;
 * text types with NUL bytes answer 415 like any other binary.
 *
 *   400 invalid_path | path_required | path_traversal | not_a_file | project_path_unavailable
 *   403 path_not_evidenced | sensitive_location    404 task_not_found | not_found
 *   413 file_too_large        415 binary_not_previewable    500 file_read_failed
 */

import { Hono } from "hono";
import { stat } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";

import { decideSessionFileAccess } from "../../core/session-file/access.js";
import { findSessionEvidence, type EvidenceDeps } from "../../core/session-file/evidence.js";
import { readRegularFileCapped } from "../../core/session-file/safe-read.js";
import type { SdkSessionsStore } from "../../core/sdk-sessions-store.js";
import type { SessionWatcher } from "../../core/session-watcher.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";
import { FILE_MAX_BYTES, MIME_BY_EXTENSION, fileFingerprint, sanitizeContentDispositionFilename } from "../file/_helpers.js";

export interface SessionFileRouterDeps extends EvidenceDeps {
  store: SdkSessionsStore;
  watcher: SessionWatcher;
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
}

async function existingDir(p: string | undefined | null): Promise<string | null> {
  if (!p || !isAbsolute(p)) return null;
  try {
    return (await stat(p)).isDirectory() ? p : null;
  } catch {
    return null;
  }
}

const hasNul = (b: Buffer): boolean => b.subarray(0, 8192).includes(0);

export function createSessionFileRouter(deps: SessionFileRouterDeps): Hono {
  const app = new Hono();
  const { store, watcher } = deps;

  app.get("/api/external/tasks/:id/session-file", async (c) => {
    const task = store.get(c.req.param("id"));
    if (!task) return c.json({ error: "task_not_found" }, 404);

    // Only the registered project root is trusted outright. The task cwd is client-supplied at task
    // creation (it may be a home dir or a drive root), so it is NEVER a root: a task without a
    // resolvable project gets session-evidenced absolute paths only.
    const projectDir = await existingDir(deps.getProjectById?.(task.projectId)?.path);
    const roots: string[] = projectDir ? [projectDir] : [];

    const decision = await decideSessionFileAccess({
      roots,
      requested: c.req.query("path") ?? "",
      findEvidence: async (candidates) =>
        findSessionEvidence(task.sessionUuid, await watcher.findByUuid(task.sessionUuid), candidates, deps),
    });
    if (!decision.ok) {
      return c.json({ error: decision.error, ...(decision.detail ? { detail: decision.detail } : {}) }, decision.status);
    }

    const ext = extname(decision.absolute).toLowerCase().slice(1);
    const mime = MIME_BY_EXTENSION[ext];
    if (!mime) {
      return c.json({ error: "binary_not_previewable", mime: "application/octet-stream", extension: ext || null }, 415);
    }

    const read = await readRegularFileCapped(decision.absolute, FILE_MAX_BYTES);
    if (read.kind === "not_found") return c.json({ error: "not_found" }, 404);
    if (read.kind === "not_a_file") return c.json({ error: "not_a_file" }, 400);
    if (read.kind === "too_large") return c.json({ error: "file_too_large", maxBytes: FILE_MAX_BYTES, size: read.size }, 413);
    if (read.kind === "error") return c.json({ error: "file_read_failed", detail: read.detail }, 500);
    if (mime.startsWith("text/") && hasNul(read.bytes)) {
      return c.json({ error: "binary_not_previewable", mime: "application/octet-stream", extension: ext || null }, 415);
    }

    c.header("Content-Type", mime);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("ETag", `"${fileFingerprint(read.bytes)}"`);
    c.header("Content-Disposition", `inline; filename="${sanitizeContentDispositionFilename(basename(decision.absolute))}"`);
    c.header("Content-Length", String(read.bytes.length));
    c.header("Cache-Control", "private, max-age=0, must-revalidate");
    c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    c.header("X-Session-File-Scope", decision.scope);
    return c.body(new Uint8Array(read.bytes));
  });

  return app;
}
