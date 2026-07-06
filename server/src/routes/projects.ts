/*
 * /api/projects/* — minimal CRUD. Plan D'' Sub-iterate 3 simplification:
 * no more fileWatcher + eventStore + sseManager side-effects (all removed
 * with the chat/pipeline runtime).
 *
 * The wizard's "pipeline" project endpoint and initial-phase spawning are
 * gone — projects are plain metadata registrations. Pipeline mode is a
 * follow-up iterate once external-launch ships.
 */

import { Hono } from "hono";
import type { ProjectManager } from "../core/project-manager.js";
import { AppError } from "../middleware/error-handler.js";
import { normalizeFsPath } from "../core/normalize-fs-path.js";

export interface ProjectRouteDeps {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, opts?: { recursive: boolean }) => void;
  writeFileSync: (path: string, data: string) => void;
  renameSync: (from: string, to: string) => void;
}

// One-double-click-to-VS-Code: emitted into <project.path>/.shipwright-webui/
// on POST /api/projects. Relative `..` keeps the file portable across machines
// and survives directory renames. Idempotent — never overwrites a file the
// user may have customized.
const WORKSPACE_CONTENT = JSON.stringify(
  {
    folders: [{ path: ".." }],
    settings: {
      "terminal.integrated.defaultLocation": "editor",
      "explorer.compactFolders": false,
    },
  },
  null,
  2,
);

function slugifyProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createProjectRoutes(
  projectManager: ProjectManager,
  fsDeps?: ProjectRouteDeps,
  /**
   * iterate-2026-07-06-project-delete-cascades-tasks — invoked AFTER a
   * successful project delete to cascade-remove that project's tasks (so no
   * orphaned "Unassigned" bucket lingers). Returns the count removed. Wired
   * in index.ts to `cascadeDeleteProjectTasks`; omitted in unit tests that
   * don't exercise the cascade.
   */
  onProjectDeleted?: (projectId: string) => number | Promise<number>,
): Hono {
  const app = new Hono();

  app.get("/api/projects", (c) => c.json({ data: projectManager.getAll() }));

  app.get("/api/projects/:id", (c) => {
    const project = projectManager.getById(c.req.param("id"));
    if (!project) throw new AppError("Project not found", 404);
    return c.json({ data: project });
  });

  app.post("/api/projects", async (c) => {
    const body = await c.req.json();
    // Strip a paste-artifact surrounding quote pair BEFORE the fs probes and
    // create() below run against it — a quoted path would otherwise fail
    // existsSync, mkdir a garbage relative directory, and (once stored) feed a
    // broken `cd ''\''…'\'''` prefix into the launch command. See
    // core/normalize-fs-path.ts.
    if (typeof body.path === "string") body.path = normalizeFsPath(body.path);
    if (!body.name || !body.path) {
      throw new AppError("name and path are required", 400);
    }
    if (fsDeps) {
      if (!fsDeps.existsSync(body.path)) {
        fsDeps.mkdirSync(body.path, { recursive: true });
      }
      const webuiDir = `${body.path}/.shipwright-webui`;
      if (!fsDeps.existsSync(webuiDir)) {
        fsDeps.mkdirSync(webuiDir, { recursive: true });
      }
      const slug = slugifyProjectName(String(body.name));
      if (slug.length > 0) {
        const workspacePath = `${webuiDir}/${slug}.code-workspace`;
        if (!fsDeps.existsSync(workspacePath)) {
          // Atomic temp+rename mirrors sdk-sessions-store.ts convention.
          const tmpPath = `${workspacePath}.tmp`;
          fsDeps.writeFileSync(tmpPath, WORKSPACE_CONTENT);
          fsDeps.renameSync(tmpPath, workspacePath);
        }
      }
    }
    const project = projectManager.create(body);
    return c.json({ data: project }, 201);
  });

  app.patch("/api/projects/:id", async (c) => {
    const body = await c.req.json();
    // Same paste-artifact guard as POST, for path edits via the settings UI.
    if (typeof body.path === "string") body.path = normalizeFsPath(body.path);
    const updated = projectManager.update(c.req.param("id"), body);
    if (!updated) throw new AppError("Project not found", 404);
    return c.json({ data: updated });
  });

  app.delete("/api/projects/:id", async (c) => {
    const id = c.req.param("id");
    // Throws AppError(404) when the id is unknown — the cascade below is
    // skipped in that case (the throw short-circuits to the error handler).
    projectManager.delete(id);
    // iterate-2026-07-06-project-delete-cascades-tasks — cascade-remove the
    // project's tasks so no orphaned "Unassigned" bucket survives. Without
    // this the tasks keep a dangling projectId and the projects list keeps
    // synthesizing a phantom, un-clearable Unassigned row.
    const deletedTaskCount = onProjectDeleted ? await onProjectDeleted(id) : 0;
    return c.json({ ok: true, deletedTaskCount });
  });

  return app;
}
