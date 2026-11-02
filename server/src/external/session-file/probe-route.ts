/*
 * POST /api/external/tasks/:id/session-file/probe  { paths: string[] }  ->  { results: [{ openable, reason? }] }
 *
 * "Is this path openable by the Viewer?" for chat chips, Outputs rows and terminal links, so a dead path is
 * never presented as a link. Same access rules as GET /session-file (core/session-file/access.ts); no
 * content, no listing. Bounded: at most MAX_PROBE_PATHS paths per call and PROBE_BURST calls per task per
 * window (429 probe_rate_limited - callers fail OPEN, the Viewer then reports the real state).
 *
 *   400 invalid_body | too_many_paths    404 task_not_found    429 probe_rate_limited
 */

import type { Hono } from "hono";
import { stat } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";

import { MAX_PATH_CHARS } from "../../core/session-file/access.js";
import { findSessionEvidence } from "../../core/session-file/evidence.js";
import { MAX_PROBE_PATHS, probeOpenable } from "../../core/session-file/probe.js";
import { FILE_MAX_BYTES, MIME_BY_EXTENSION } from "../file/_helpers.js";
import type { SessionFileRouterDeps } from "./routes.js";

const PROBE_WINDOW_MS = 10_000;
const PROBE_BURST = 30;

async function existingDir(p: string | undefined | null): Promise<string | null> {
  if (!p || !isAbsolute(p)) return null;
  try {
    return (await stat(p)).isDirectory() ? p : null;
  } catch {
    return null;
  }
}

export function registerProbeRoute(app: Hono, deps: SessionFileRouterDeps): void {
  const { store, watcher } = deps;
  const calls = new Map<string, number[]>();

  app.post("/api/external/tasks/:id/session-file/probe", async (c) => {
    const taskId = c.req.param("id");
    const task = store.get(taskId);
    if (!task) return c.json({ error: "task_not_found" }, 404);

    const now = Date.now();
    const recent = (calls.get(taskId) ?? []).filter((t) => now - t < PROBE_WINDOW_MS);
    if (recent.length >= PROBE_BURST) return c.json({ error: "probe_rate_limited" }, 429);
    calls.set(taskId, [...recent, now]);
    if (calls.size > 500) for (const [k, v] of calls) if (v.every((t) => now - t >= PROBE_WINDOW_MS)) calls.delete(k);

    const body = (await c.req.json().catch(() => null)) as { paths?: unknown } | null;
    const paths = body?.paths;
    if (!Array.isArray(paths) || paths.length === 0 || !paths.every((p) => typeof p === "string")) {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (paths.length > MAX_PROBE_PATHS) return c.json({ error: "too_many_paths", max: MAX_PROBE_PATHS }, 400);

    const projectDir = await existingDir(deps.getProjectById?.(task.projectId)?.path);
    const roots: string[] = projectDir ? [projectDir] : [];
    const results = await probeOpenable({
      roots,
      // An over-long entry is cut one char past the cap: the decision core rejects it as invalid_path.
      paths: (paths as string[]).map((p) => (p.length > MAX_PATH_CHARS ? p.slice(0, MAX_PATH_CHARS + 1) : p)),
      findEvidence: async (candidates) =>
        findSessionEvidence(task.sessionUuid, await watcher.findByUuid(task.sessionUuid), candidates, deps),
      maxBytes: FILE_MAX_BYTES,
      previewable: (abs) => MIME_BY_EXTENSION[extname(abs).toLowerCase().slice(1)] !== undefined,
    });
    return c.json({ results });
  });
}
